function createPanelStore() {
  let open = $state(false);

  return {
    get open() { return open; },
    toggle() { open = !open; },
    close() { open = false; },
    openPanel() { open = true; },
  };
}

export const panelStore = createPanelStore();
