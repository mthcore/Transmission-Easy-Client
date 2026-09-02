import React, { useCallback } from 'react';
import { observer } from 'mobx-react';
import Select, { Option } from 'rc-select';
import useRootStore from '../hooks/useRootStore';

const LabelSelect = observer(() => {
  const rootStore = useRootStore();
  const config = rootStore?.config;

  const handleChange = useCallback(
    (value: string) => {
      const selectedLabel = JSON.parse(value) as { label: string; custom: boolean };
      config?.setSelectedLabel(selectedLabel.label, selectedLabel.custom);
    },
    [config]
  );

  if (!config) return null;

  const selectedLabel = config.selectedLabel;

  // The filters list is rebuilt from labels present on CURRENT torrents, but
  // selectedLabel is persisted: with the last matching torrent gone, the list
  // filtered down to nothing while the dropdown rendered blank. Keep the ghost
  // label visible as an entry so the user can see — and leave — the filter.
  // (`custom: false` is a user label; `custom: true` are the built-in
  // categories.) The built-ins were assumed always present, but a persisted
  // selection from another build — or one dropped from customLabels — left
  // selectedValue null and the Select fell back to uncontrolled and blank,
  // the exact symptom this exists to prevent. Match on both flags instead.
  const filters = rootStore.torrentList.filters.slice();
  if (!filters.some((f) => f.custom === selectedLabel.custom && f.label === selectedLabel.label)) {
    filters.push({ label: selectedLabel.label, custom: selectedLabel.custom });
  }

  let selectedValue: string | null = null;
  const options = filters.map(({ label, custom: isCustom }) => {
    const id = JSON.stringify({ label, custom: isCustom });

    let text: string | null = null;
    if (isCustom) {
      // Falling back to the raw label matters for the ghost entry above: a
      // built-in persisted by another build has no translation here, and an
      // untranslated entry rendered as an empty line — the very blankness this
      // whole mechanism exists to prevent.
      const key = label === 'SEEDING' ? 'OV_FL_' + label : 'OV_CAT_' + label;
      text = chrome.i18n.getMessage(key) || label;
    } else {
      text = label;
    }

    let dataImage: string | null = null;
    let image: React.ReactNode = null;
    if (isCustom) {
      dataImage = label;
      image = <span className="image" data-image={dataImage} />;
    }

    if (selectedLabel.id === id) {
      selectedValue = id;
    }

    return (
      <Option key={id} value={id}>
        {image}
        <span title={text || undefined}>{text}</span>
      </Option>
    );
  });

  return (
    <li className="select">
      <Select
        // Controlled: with defaultValue only, an external change (context-menu
        // auto-switch to DL, another window's storage sync) filtered the list
        // while the dropdown kept displaying the stale label
        value={selectedValue || undefined}
        onChange={handleChange}
        showSearch={false}
        optionLabelProp="children"
        virtual={false}
        listHeight={500}
        aria-label={chrome.i18n.getMessage('OV_CAT_ALL')}
      >
        {options}
      </Select>
    </li>
  );
});

export default LabelSelect;
