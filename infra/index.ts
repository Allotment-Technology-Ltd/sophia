import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

// ─── Stack config ─────────────────────────────────────────────────────────────
const config = new pulumi.Config("sophia");
const gcpConfig = new pulumi.Config("gcp");

const projectId = gcpConfig.require("project");
const region = config.require("region");                   // europe-west2
const zone = config.require("zone");                       // europe-west2-b
const dbInternalIp = config.require("dbInternalIp");       // 10.154.0.2  (stable VPC IP)
const vpcConnectorRange = config.require("vpcConnectorRange"); // 10.8.0.0/28

const appMinInstances = parseInt(config.require("appMinInstances"));
const appMaxInstances = parseInt(config.require("appMaxInstances"));
const appMemory = config.require("appMemory");
const appCpu = config.require("appCpu");
const ingestMemory = config.require("ingestMemory");
const ingestCpu = config.require("ingestCpu");
const ingestTimeoutSeconds = config.require("ingestTimeoutSeconds");

// ─── Service accounts ─────────────────────────────────────────────────────────

// Service account for the Cloud Run app
const appSa = new gcp.serviceaccount.Account("app-sa", {
  accountId: "sophia-app",
  displayName: "Sophia Cloud Run App",
  description: "Service account for the Sophia Cloud Run service",
  project: projectId,
});

new gcp.projects.IAMMember("app-sa-secret-accessor", {
  project: projectId,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${appSa.email}`,
});

new gcp.projects.IAMMember("app-sa-vertex-user", {
  project: projectId,
  role: "roles/aiplatform.user",
  member: pulumi.interpolate`serviceAccount:${appSa.email}`,
});

new gcp.projects.IAMMember("app-sa-log-writer", {
  project: projectId,
  role: "roles/logging.logWriter",
  member: pulumi.interpolate`serviceAccount:${appSa.email}`,
});

// Service account for ingestion jobs
const ingestSa = new gcp.serviceaccount.Account("ingest-sa", {
  accountId: "sophia-ingest",
  displayName: "Sophia Ingestion Jobs",
  description: "Service account for Cloud Run ingestion jobs",
  project: projectId,
});

new gcp.projects.IAMMember("ingest-sa-secret-accessor", {
  project: projectId,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${ingestSa.email}`,
});

new gcp.projects.IAMMember("ingest-sa-vertex-user", {
  project: projectId,
  role: "roles/aiplatform.user",
  member: pulumi.interpolate`serviceAccount:${ingestSa.email}`,
});

new gcp.projects.IAMMember("ingest-sa-log-writer", {
  project: projectId,
  role: "roles/logging.logWriter",
  member: pulumi.interpolate`serviceAccount:${ingestSa.email}`,
});

// ─── Artifact Registry ────────────────────────────────────────────────────────

// Single repository in europe-west2 for all Sophia images (app + ingest)
const registry = new gcp.artifactregistry.Repository("sophia-registry", {
  repositoryId: "sophia",
  location: region,  // europe-west2
  format: "DOCKER",
  description: "Sophia container images — app and ingestion jobs",
  project: projectId,
}, {
  // If the repo already exists (from ingest images), import it:
  // pulumi import gcp:artifactregistry/repository:Repository sophia-registry projects/sophia-488807/locations/europe-west2/repositories/sophia
  ignoreChanges: ["labels"],
});

// ─── VPC Connector ────────────────────────────────────────────────────────────
//
// Enables Cloud Run (serverless) to reach the private IP of the GCE SurrealDB
// VM without going over the public internet.
//
// IMPORTANT: Must be in the same region as the Cloud Run service.
// The old connector was in europe-west1 — this one is in europe-west2.

const vpcConnector = new gcp.vpcaccess.Connector("sophia-connector", {
  name: "sophia-connector",
  region: region,  // europe-west2
  network: "default",
  ipCidrRange: vpcConnectorRange,  // 10.8.0.0/28
  project: projectId,
  minInstances: 2,
  maxInstances: 10,
});

// ─── Firewall ─────────────────────────────────────────────────────────────────
//
// Restricts SurrealDB access to the VPC connector CIDR only.
// Replaces the previous 0.0.0.0/0 rule — admins use Cloud IAP or bastion.
//
// To import the existing rule instead of recreating it:
//   pulumi import gcp:compute/firewall:Firewall allow-surrealdb \
//     projects/sophia-488807/global/firewalls/allow-surrealdb

new gcp.compute.Firewall("allow-surrealdb", {
  name: "allow-surrealdb",
  network: "default",
  direction: "INGRESS",
  targetTags: ["sophia-db"],  // matches VM tag on sophia-db instance
  allows: [{ protocol: "tcp", ports: ["8000"] }],
  sourceRanges: [vpcConnectorRange],  // VPC connector CIDR only, not 0.0.0.0/0
  description: "Allow SurrealDB access from Cloud Run VPC connector only",
  project: projectId,
});

// ─── Cloud Run — App ─────────────────────────────────────────────────────────
//
// appImageTag is set by the CI pipeline via `pulumi config set sophia:appImageTag <sha>`
// before running `pulumi up`, so each deployment tracks the exact image.

const appImageTag = config.get("appImageTag") ?? "latest";
const appImage = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/sophia/app:${appImageTag}`;

const appService = new gcp.cloudrunv2.Service("sophia-app", {
  name: "sophia",
  location: region,  // europe-west2
  project: projectId,
  ingress: "INGRESS_TRAFFIC_ALL",
  template: {
    serviceAccount: appSa.email,
    vpcAccess: {
      connector: vpcConnector.id,
      egress: "PRIVATE_RANGES_ONLY",
    },
    scaling: {
      minInstanceCount: appMinInstances,
      maxInstanceCount: appMaxInstances,
    },
    containers: [{
      image: appImage,
      resources: {
        limits: {
          memory: appMemory,
          cpu: appCpu,
        },
      },
      envs: [
        { name: "SURREAL_URL",            value: `ws://${dbInternalIp}:8000/rpc` },
        { name: "SURREAL_USER",           value: "root" },
        { name: "SURREAL_NAMESPACE",      value: "sophia" },
        { name: "SURREAL_DATABASE",       value: "sophia" },
        { name: "GCP_LOCATION",           value: region },
        { name: "GOOGLE_VERTEX_LOCATION", value: region },
        {
          name: "ANTHROPIC_API_KEY",
          valueSource: { secretKeyRef: { secret: "anthropic-api-key", version: "latest" } },
        },
        {
          name: "SURREAL_PASS",
          valueSource: { secretKeyRef: { secret: "surreal-db-pass", version: "latest" } },
        },
        {
          name: "VOYAGE_API_KEY",
          valueSource: { secretKeyRef: { secret: "voyage-api-key", version: "latest" } },
        },
        {
          name: "GOOGLE_AI_API_KEY",
          valueSource: { secretKeyRef: { secret: "google-ai-api-key", version: "latest" } },
        },
      ],
    }],
  },
}, { dependsOn: [vpcConnector, registry] });

// Public access — allow unauthenticated invocations
new gcp.cloudrunv2.ServiceIamMember("sophia-app-public", {
  project: projectId,
  location: region,
  name: appService.name,
  role: "roles/run.invoker",
  member: "allUsers",
});

// ─── Cloud Run Job — Ingestion ────────────────────────────────────────────────

const ingestImage = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/sophia/sophia-ingest:v2-live`;

const ingestJob = new gcp.cloudrunv2.Job("sophia-ingest", {
  name: "sophia-ingest",
  location: region,
  project: projectId,
  template: {
    template: {
      serviceAccount: ingestSa.email,
      maxRetries: 0,
      timeout: `${ingestTimeoutSeconds}s`,
      vpcAccess: {
        connector: vpcConnector.id,
        egress: "PRIVATE_RANGES_ONLY",
      },
      containers: [{
        image: ingestImage,
        resources: {
          limits: {
            memory: ingestMemory,
            cpu: ingestCpu,
          },
        },
        envs: [
          { name: "WAVE_NUM",          value: "1" },  // overridden per execution
          { name: "SURREAL_URL",       value: `http://${dbInternalIp}:8000/rpc` },
          { name: "SURREAL_USER",      value: "root" },
          { name: "SURREAL_NAMESPACE", value: "sophia" },
          { name: "SURREAL_DATABASE",  value: "sophia" },
          { name: "GCP_LOCATION",      value: region },
          {
            name: "ANTHROPIC_API_KEY",
            valueSource: { secretKeyRef: { secret: "anthropic-api-key", version: "latest" } },
          },
          {
            name: "SURREAL_PASS",
            valueSource: { secretKeyRef: { secret: "surreal-db-pass", version: "latest" } },
          },
          {
            name: "VOYAGE_API_KEY",
            valueSource: { secretKeyRef: { secret: "voyage-api-key", version: "latest" } },
          },
          {
            name: "GOOGLE_AI_API_KEY",
            valueSource: { secretKeyRef: { secret: "google-ai-api-key", version: "latest" } },
          },
        ],
      }],
    },
  },
}, {
  dependsOn: [vpcConnector, registry],
});

// ─── Outputs ──────────────────────────────────────────────────────────────────

export const appServiceUrl = appService.uri;
export const appServiceName = appService.name;
export const appServiceRegion = appService.location;
export const appImagePath = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/sophia/app`;
export const ingestImagePath = pulumi.interpolate`${region}-docker.pkg.dev/${projectId}/sophia/sophia-ingest`;
export const vpcConnectorId = vpcConnector.id;
export const registryLocation = registry.location;
export const appServiceAccountEmail = appSa.email;
export const ingestServiceAccountEmail = ingestSa.email;
