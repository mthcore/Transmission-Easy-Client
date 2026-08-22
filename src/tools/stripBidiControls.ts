/**
 * Removes Unicode bidirectional control characters from untrusted display
 * text. A torrent named with U+202E (RIGHT-TO-LEFT OVERRIDE) renders
 * "holiday-photos‮gnp.exe" as "holiday-photosexe.png" — the classic
 * extension-spoofing trick — in the list, in dialogs, and in OS notifications.
 *
 * Stripped: LRM/RLM (200E/200F), LRE/RLE/PDF/LRO/RLO (202A-202E),
 * LRI/RLI/FSI/PDI (2066-2069), ALM (061C).
 * Legitimate RTL text needs none of these to display correctly — the bidi
 * algorithm handles Hebrew/Arabic on its own.
 */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

export default stripBidiControls;
