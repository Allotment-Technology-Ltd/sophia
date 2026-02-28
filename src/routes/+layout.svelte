<script lang="ts">
  import '../app.css';
</script>

<svelte:head>
  <title>SOPHIA — Philosophical Reasoning Engine</title>
  <meta name="description" content="Apply structured philosophical reasoning to any question, dilemma, or argument" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<slot />

<style global>
  :global(body) {
    margin: 0;
    padding: 0;
  }
</style>
