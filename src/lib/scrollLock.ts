/**
 * Freezes background scrolling while a modal or drawer is open — without moving
 * the page.
 *
 * The obvious implementation, `document.body.style.overflow = "hidden"`,
 * changes which box the browser scrolls. Anything that resizes the page while
 * the dialog is open then lands the viewport somewhere else the moment the lock
 * is released: filing a dispute adds a case panel, a payment clears the form,
 * and the page appears to scroll itself right after a submit. The member loses
 * their place for no visible reason.
 *
 * Instead the body is pinned at its current offset (`position: fixed`, shifted
 * by `-scrollY`) and that exact offset is restored on release, so opening,
 * submitting and closing a dialog is invisible to the scroll position.
 *
 * Safe to nest: the first lock captures the offset, and the last release
 * restores it. Releasing twice is a no-op.
 */

type Pinned = {
  style: CSSStyleDeclaration;
  previous: Record<string, string>;
  offset: number;
};

let depth = 0;
let pinned: Pinned | null = null;

function apply(): void {
  const style = document.body.style;
  const offset = window.scrollY;
  const previous = {
    position: style.position,
    top: style.top,
    left: style.left,
    right: style.right,
    width: style.width,
    overflow: style.overflow,
  };
  style.position = "fixed";
  style.top = `-${offset}px`;
  style.left = "0";
  style.right = "0";
  style.width = "100%";
  style.overflow = "hidden";
  pinned = { style, previous, offset };
}

function release(): void {
  const current = pinned;
  pinned = null;
  if (!current) return;
  Object.assign(current.style, current.previous);
  // Put the view back exactly where it was. The page may have grown or shrunk
  // while the dialog was open (a new dispute case, a cleared form); the member
  // must still be looking at the same thing they were.
  window.scrollTo({ top: current.offset, left: 0, behavior: "instant" as ScrollBehavior });
}

/** Locks page scrolling (nested calls are reference-counted). Returns the unlock. */
export function lockScroll(): () => void {
  if (depth === 0) apply();
  depth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) release();
  };
}
