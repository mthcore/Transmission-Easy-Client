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

  let selectedValue: string | null = null;
  const options = rootStore.torrentList.filters.map(({ label, custom: isCustom }) => {
    const id = JSON.stringify({ label, custom: isCustom });

    let text: string | null = null;
    if (isCustom) {
      if (label === 'SEEDING') {
        text = chrome.i18n.getMessage('OV_FL_' + label);
      } else {
        text = chrome.i18n.getMessage('OV_CAT_' + label);
      }
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
