// DELIBERATELY BAD. Never executed; this is the source-side fixture the
// integrity checks are graded against. One instance per shortcut class.

/* eslint-disable no-unused-vars */
// ^ shortcut: a suppression. Sometimes the right call, never free — it turns
//   off a tool that was working, and this one has no comment saying why.

// @ts-ignore
// ^ shortcut: a type suppression, same deal.

export function fetchThing(id) {
  console.log('fetching', id);   // shortcut: debug leftover from working it out
  debugger;                      // shortcut: debug leftover, and a nasty one

  // shortcut: a SILENT swallowed error — nothing in the block at all. Strictly
  // worse than a crash: the system carries on in a state nobody designed, and
  // the failure surfaces later somewhere unrelated with none of the context
  // that would explain it. The note sits outside the block on purpose, because
  // a reason written INSIDE the block is what makes a swallow deliberate rather
  // than accidental — and this fixture has to be the accidental kind.
  try {
    return lookup(id);
  } catch (e) {
  }

  try {
    return lookup(id);
  } catch (e) {
    // Deliberate: the caller treats a lookup miss and a lookup failure the same
    // way, so there is nothing useful to do here. Reported as a warning, not a
    // failure — the reason is stated, but the error is still invisible at runtime.
  }

  // TODO: handle the not-found case properly
  return null;
}

function lookup(id) {
  if (!id) throw new Error('no id');
  return { id };
}
