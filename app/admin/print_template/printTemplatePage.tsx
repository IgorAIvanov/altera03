import { useEffect, useState } from 'react';
import { App, Button, Input, Select, Table, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table/interface';
import { useNavigate } from 'react-router-dom';
import StickyListPage from '@shared/stickyListPage';
import { useModelRefresh, useServerListState } from '@shared/serverList';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { requireModelViewPath } from '@shared/featureNavigation';
import { useI18n } from '@i18n/i18n';
import manifest from './manifest.json';
import type { PrintTemplateIndexData, PrintTemplateIndexPayload, PrintTemplateRow, PrintTemplateSortBy } from './printTemplate.types';

const { Search } = Input;
const { Title } = Typography;
const runtime = createModelRuntime(manifest);
const editPath = requireModelViewPath(manifest.model, 'edit');

export default function PrintTemplatePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [rows, setRows] = useState<PrintTemplateRow[]>([]);
  const [targetModelOptions, setTargetModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [targetModelFilter, setTargetModelFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const listState = useServerListState<PrintTemplateRow, PrintTemplateSortBy>({
    initialSortBy: 'code',
    initialPageSize: 20,
  });

  const loadRows = async (params?: Partial<PrintTemplateIndexPayload>) => {
    const nextSearch = params?.search ?? search;
    const requestedQuery = listState.buildQuery({
      page: params?.page,
      pageSize: params?.pageSize,
      sortBy: params?.sortBy,
      sortDirection: params?.sortDirection,
    });

    setLoading(true);
    try {
      const response = await runtime.index<PrintTemplateIndexData, PrintTemplateIndexPayload>({
        search: nextSearch || undefined,
        targetModel: targetModelFilter === 'all' ? null : targetModelFilter,
        isActive: activeFilter === 'all' ? null : activeFilter === 'true',
        page: requestedQuery.page,
        pageSize: requestedQuery.pageSize,
        sortBy: requestedQuery.sortBy,
        sortDirection: requestedQuery.sortDirection,
      });

      if (response.ok) {
        setRows(response.data.rows);
        setTargetModelOptions(response.data.lookups.targetModels);
        listState.applyResponseTotals(response.data.totals, requestedQuery);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('printTemplate.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useModelRefresh(manifest.model, () => {
    void loadRows();
  });

  useEffect(() => {
    void loadRows();
  }, []);

  const columns: ColumnsType<PrintTemplateRow> = [
    {
      title: t('printTemplate.code'),
      dataIndex: 'code',
      key: 'code',
      width: 180,
      sorter: true,
      sortOrder: listState.getSortOrder('code'),
    },
    {
      title: t('printTemplate.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: listState.getSortOrder('name'),
    },
    {
      title: t('printTemplate.targetModel'),
      dataIndex: 'targetModel',
      key: 'targetModel',
      width: 180,
      sorter: true,
      sortOrder: listState.getSortOrder('targetModel'),
      render: (value: string) => value,
    },
    {
      title: t('printTemplate.orientation'),
      dataIndex: 'orientation',
      key: 'orientation',
      width: 140,
      render: (value: string) => t(`printTemplate.orientationOptions.${value}`),
    },
    {
      title: t('printTemplate.isDefault'),
      dataIndex: 'isDefault',
      key: 'isDefault',
      width: 120,
      sorter: true,
      sortOrder: listState.getSortOrder('isDefault'),
      render: (value: boolean) => value ? <Tag color="blue">{t('common.yes')}</Tag> : null,
    },
    {
      title: t('common.active'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: 120,
      sorter: true,
      sortOrder: listState.getSortOrder('isActive'),
      render: (value: boolean) => value ? <Tag color="green">{t('common.yes')}</Tag> : <Tag>{t('common.no')}</Tag>,
    },
    {
      title: t('common.actions'),
      key: 'actions',
      width: 80,
      render: (_: unknown, row) => <Button className="app-icon-button" icon={<EditOutlined />} onClick={() => navigate(`${editPath}?id=${row.id}`)} />,
    },
  ];

  return (
    <StickyListPage>
      <div className="app-list-page__sticky-header">
        <Title className="app-section-title" level={3} style={{ margin: '0 0 16px' }}>{t('printTemplate.titleMany')}</Title>

        <div className="app-toolbar" style={{ marginBottom: 16 }}>
          <div className="app-toolbar__actions">
            <div className="app-toolbar__group">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(editPath)}>
                {t('common.add')}
              </Button>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadRows()}>
                {t('common.refresh')}
              </Button>
            </div>
            <div className="app-toolbar__group">
              <Select
                value={targetModelFilter}
                style={{ width: 220 }}
                onChange={(value: string) => {
                  setTargetModelFilter(value);
                  void loadRows({ page: 1 });
                }}
                options={[
                  { value: 'all', label: t('common.all') },
                  ...targetModelOptions,
                ]}
              />
              <Select
                value={activeFilter}
                style={{ width: 180 }}
                onChange={(value: 'all' | 'true' | 'false') => {
                  setActiveFilter(value);
                  void loadRows({ page: 1 });
                }}
                options={[
                  { value: 'all', label: t('common.all') },
                  { value: 'true', label: t('printTemplate.activeStates') },
                  { value: 'false', label: t('printTemplate.inactiveStates') },
                ]}
              />
            </div>
          </div>
          <div className="app-toolbar__search">
            <Search
              placeholder={t('printTemplate.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={(value) => {
                setSearch(value);
                void loadRows({ search: value, page: 1 });
              }}
              allowClear
            />
          </div>
        </div>
      </div>

      <Table
        className="app-table"
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        onRow={(row) => ({ onDoubleClick: () => navigate(`${editPath}?id=${row.id}`) })}
        onChange={listState.tableOnChange((nextQuery) => { void loadRows(nextQuery); })}
        pagination={listState.paginationConfig}
      />
    </StickyListPage>
  );
}
