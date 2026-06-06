import { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Modal, Space, Table, Typography } from 'antd';
import LookupPickerField from '@components/lookupPickerField';
import { useI18n } from '@i18n/i18n';
import { getFeatureManifestByModel } from '@shared/featureManifest';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { appModalStyles } from '@shared/modalStyles';
import type { LookupOption } from './printTemplate.types';

interface PreviewObjectPickerProps {
  targetModel: string;
  value?: string;
  disabled?: boolean;
  onChange?: (value: string | undefined, option?: LookupOption) => void;
}

interface GenericFetchData {
  rows?: unknown;
}

const { Search } = Input;
const { Text } = Typography;

function normalizeLookupRows(rows: unknown): LookupOption[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row): LookupOption[] => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return [];
    }

    const value = typeof row.value === 'string' ? row.value.trim() : '';
    const label = typeof row.label === 'string' ? row.label.trim() : value;
    if (!value || !label) {
      return [];
    }

    return [{ value, label }];
  });
}

export default function PreviewObjectPicker({
  targetModel,
  value,
  disabled = false,
  onChange,
}: PreviewObjectPickerProps) {
  const { message } = App.useApp();
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [selectedValue, setSelectedValue] = useState<string | undefined>(value);

  const normalizedModel = targetModel.trim();
  const manifest = useMemo(
    () => (normalizedModel ? getFeatureManifestByModel(normalizedModel) : null),
    [normalizedModel],
  );
  const runtime = useMemo(
    () => (manifest ? createModelRuntime(manifest) : null),
    [manifest],
  );
  const canFetch = Boolean(runtime?.hasCommand('fetch'));

  useEffect(() => {
    setSelectedValue(value);
  }, [value]);

  const loadOptions = async (searchValue = '') => {
    if (!runtime || !canFetch) {
      setOptions([]);
      return;
    }

    try {
      setLoading(true);
      const response = await runtime.fetch<GenericFetchData, { search?: string; limit: number }>({
        search: searchValue.trim() || undefined,
        limit: 50,
      });

      if (!response.ok) {
        message.error(response.messages[0] ?? t('printTemplate.previewSampleObjectLoadError'));
        return;
      }

      setOptions(normalizeLookupRows(response.data.rows));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('printTemplate.previewSampleObjectLoadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }

    setSearch('');
    setSelectedValue(value);
    void loadOptions();
  }, [dialogOpen, value, runtime, canFetch]);

  const selectedOption = options.find((option) => option.value === selectedValue);

  return (
    <>
      <LookupPickerField
        value={value}
        options={options}
        loading={loading}
        disabled={disabled || !canFetch}
        placeholder={t('printTemplate.previewSampleObjectPlaceholder')}
        filterOption={false}
        onSearch={(nextValue) => {
          void loadOptions(nextValue);
        }}
        onChange={(nextValue, option) => {
          onChange?.(nextValue, option);
        }}
        onOpenPicker={() => setDialogOpen(true)}
        openButtonTitle={t('printTemplate.previewSampleObjectOpen')}
      />
      {normalizedModel && !canFetch ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('printTemplate.previewSampleObjectFetchUnavailable')}
        </Text>
      ) : null}

      <Modal
        title={t('printTemplate.previewSampleObjectPickerTitle')}
        open={dialogOpen}
        styles={appModalStyles}
        rootClassName="app-picker-dialog"
        width={640}
        onCancel={() => setDialogOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button
              type="primary"
              onClick={() => {
                if (!selectedValue || !selectedOption) {
                  message.warning(t('printTemplate.previewSampleObjectSelectError'));
                  return;
                }

                onChange?.(selectedValue, selectedOption);
                setDialogOpen(false);
              }}
            >
              {t('common.select')}
            </Button>
          </Space>
        )}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          <Search
            allowClear
            value={search}
            placeholder={t('printTemplate.previewSampleObjectSearchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
            onSearch={(nextValue) => {
              setSearch(nextValue);
              void loadOptions(nextValue);
            }}
          />
          <Table
            className="app-table app-picker-dialog__table"
            rowKey="value"
            size="small"
            loading={loading}
            pagination={false}
            dataSource={options}
            rowClassName={(row) => (row.value === selectedValue ? 'app-table__row--selected' : '')}
            onRow={(row) => ({
              onClick: () => setSelectedValue(row.value),
              onDoubleClick: () => {
                onChange?.(row.value, row);
                setDialogOpen(false);
              },
            })}
            locale={{ emptyText: t('printTemplate.previewSampleObjectEmpty') }}
            columns={[
              {
                title: t('printTemplate.previewSampleObjectColumn'),
                dataIndex: 'label',
                key: 'label',
              },
              {
                title: 'ID',
                dataIndex: 'value',
                key: 'value',
                width: 220,
              },
            ]}
          />
        </Space>
      </Modal>
    </>
  );
}
