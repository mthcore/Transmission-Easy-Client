import React, { type InputHTMLAttributes } from 'react';

interface SettingToggleProps extends InputHTMLAttributes<HTMLInputElement> {
  /** i18n key for the text beside the switch */
  label: string;
}

/**
 * The labelled switch every options pane uses, stated once.
 *
 * It was written out thirty-three times across six panes — the label, the
 * wrapper, the checkbox and the slider span that draws it — so the shape of a
 * toggle lived in six files and any change to it (a class, an aria attribute,
 * the order of the elements) had to be made in all of them or in none.
 *
 * Everything except the label goes straight to the input. That is deliberate:
 * the panes use two different idioms and the difference is real, not
 * accidental. Daemon settings are CONTROLLED, because they change from outside
 * the page — another client, a scheduled alt-speed window — and the switch has
 * to follow. Local configuration is UNCONTROLLED with a `name`, because only
 * this page writes it and the generic handler reads the name to know what
 * changed. Collapsing the two into one prop shape would hide a distinction the
 * reader needs.
 */
const SettingToggle = ({ label, ...input }: SettingToggleProps) => (
  <label>
    <span>{chrome.i18n.getMessage(label)}</span>
    <span className="toggle-switch">
      <input type="checkbox" {...input} />
      <span className="toggle-slider"></span>
    </span>
  </label>
);

export default SettingToggle;
