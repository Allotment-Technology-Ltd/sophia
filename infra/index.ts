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

new gcp.projects.IAMMember("app-sa-firebase-auth", {
  project: projectId,
  role: "roles/firebase.admin",
  member: pulumi.interpolate`serviceAccount:${appSa.email}`,
});

new gcp.projects.IAMMember("app-sa-datastore-user", {
  project: projectId,
  role: "roles/datastore.user",
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
      egress: "ALL_TRAFFIC",
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
        { name: "SURREAL_URL",            value: `http://${dbInternalIp}:8000/rpc` },
        { name: "SURREAL_USER",           value: "root" },
        { name: "SURREAL_NAMESPACE",      value: "sophia" },
        { name: "SURREAL_DATABASE",       value: "sophia" },
        { name: "GCP_PROJECT_ID",         value: projectId },
        { name: "GOOGLE_VERTEX_PROJECT",  value: projectId },
        { name: "GCP_LOCATION",           value: region },
        { name: "GOOGLE_VERTEX_LOCATION", value: "us-central1" },
        { name: "VITE_FIREBASE_PROJECT_ID", value: projectId },
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
        {
          name: "VITE_FIREBASE_API_KEY",
          valueSource: { secretKeyRef: { secret: "firebase-api-key", version: "latest" } },
        },
        {
          name: "VITE_FIREBASE_AUTH_DOMAIN",
          valueSource: { secretKeyRef: { secret: "firebase-auth-domain", version: "latest" } },
        },
        {
          name: "ADMIN_UIDS",
          valueSource: { secretKeyRef: { secret: "admin-uids", version: "latest" } },
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
          { name: "GCP_PROJECT_ID",    value: projectId },
          { name: "GOOGLE_VERTEX_PROJECT", value: projectId },
          { name: "GCP_LOCATION",      value: region },
          { name: "GOOGLE_VERTEX_LOCATION", value: "us-central1" },
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

// ─── Load Balancer & Domain Mapping ──────────────────────────────────────────────────────────────────

// 1. Reserve Static IP
const lbIp = new gcp.compute.GlobalAddress("sophia-lb-ip", {
    project: projectId,
    addressType: "EXTERNAL",
    ipVersion: "IPV4",
});

// 2. Create Serverless NEG (Connects to the Cloud Run service above)
const serverlessNeg = new gcp.compute.RegionNetworkEndpointGroup("sophia-neg", {
    project: projectId,
    region: region,
    networkEndpointType: "SERVERLESS",
    cloudRun: {
        service: appService.name, // Explicitly links to your appService resource
    },
});

// 3. Create the Backend Service
// Using 'EXTERNAL_MANAGED' is the modern, production-grade approach.
const backendService = new gcp.compute.BackendService("sophia-backend", {
  project: projectId,
  loadBalancingScheme: "EXTERNAL_MANAGED",
  protocol: "HTTPS",
  timeoutSec: 30,
  backends: [{
    group: serverlessNeg.id,
  }],
  // Best-in-class tip: Enabling connection draining prevents 
  // users from being dropped during deployments.
  connectionDrainingTimeoutSec: 300,
});

// 4. Create the Google-managed SSL Certificate
const sslCert = new gcp.compute.ManagedSslCertificate("sophia-ssl", {
  project: projectId,
  managed: {
    domains: ["usesophia.app", "www.usesophia.app"],
  },
});

// 5. Create the URL Map (The Router)
const urlMap = new gcp.compute.URLMap("sophia-url-map", {
  project: projectId,
  defaultService: backendService.id,
});

// 6. Create the Target HTTPS Proxy (SSL Terminator)
const httpsProxy = new gcp.compute.TargetHttpsProxy("sophia-https-proxy", {
  project: projectId,
  urlMap: urlMap.id,
  sslCertificates: [sslCert.id],
});

// 7. Global Forwarding Rule for Port 443
const httpsForwardingRule = new gcp.compute.GlobalForwardingRule("sophia-https-rule", {
  project: projectId,
  target: httpsProxy.id,
  portRange: "443",
  ipAddress: lbIp.address,
  loadBalancingScheme: "EXTERNAL_MANAGED",
});

// 8. Create a URL Map for Redirection
const redirectUrlMap = new gcp.compute.URLMap("sophia-redirect-map", {
  project: projectId,
  defaultUrlRedirect: {
    httpsRedirect: true,
    stripQuery: false,
  },
});

// 9. Target HTTP Proxy
const httpProxy = new gcp.compute.TargetHttpProxy("sophia-http-proxy", {
  project: projectId,
  urlMap: redirectUrlMap.id,
});

// 10. Forwarding Rule for Port 80
const httpForwardingRule = new gcp.compute.GlobalForwardingRule("sophia-http-rule", {
  project: projectId,
  target: httpProxy.id,
  portRange: "80",
  ipAddress: lbIp.address, // Shares the same static IP!
  loadBalancingScheme: "EXTERNAL_MANAGED",
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
export const staticIpAddress = lbIp.address;
