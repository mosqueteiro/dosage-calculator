/**
 * Drawer UI: hamburger menu holding the Presets, History and Settings
 * sections so the calculator stays front and centre. Opens on menu-button
 * click; closes on ✕, backdrop tap, or Escape.
 */
/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/**
 * Wire the menu button, backdrop, and close control.
 *
 * @returns {void}
 */
export function initDrawer() {
  const button = /** @type {HTMLButtonElement} */ (byId('menu-button'));
  const drawer = byId('drawer');
  const backdrop = byId('drawer-backdrop');
  const closeBtn = /** @type {HTMLButtonElement} */ (byId('drawer-close'));

  /**
   * @param {boolean} open
   * @returns {void}
   */
  function setOpen(open) {
    drawer.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    // Lock background scrolling while the drawer is open.
    document.body.classList.toggle('drawer-lock', open);
    if (open) {
      closeBtn.focus();
    } else {
      button.focus();
    }
  }

  button.addEventListener('click', () => {
    setOpen(!drawer.classList.contains('open'));
  });
  closeBtn.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer.classList.contains('open')) {
      setOpen(false);
    }
  });
}
