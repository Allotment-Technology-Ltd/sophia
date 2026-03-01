<script lang="ts">
  import StatusBar from './StatusBar.svelte';
  import ViewToggle, { type ViewMode } from './ViewToggle.svelte';
  import ClaimsView from './ClaimsView.svelte';
  import SourcesView from './SourcesView.svelte';

  let viewMode = $state<ViewMode>('claims');
</script>

<div class="references-tab">
  <StatusBar />
  <ViewToggle active={viewMode} onToggle={(mode) => viewMode = mode} />

  {#if viewMode === 'claims'}
    <ClaimsView />
  {:else}
    <SourcesView />
  {/if}
</div>

<style>
  .references-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
