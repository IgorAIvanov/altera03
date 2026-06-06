import { useEffect, useState } from 'react';
import { App, Button, Input, Select, Table, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table/interface';
import { useNavigate } from 'react-router-dom';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { requireModelViewPath } from '@shared/featureNavigation';
import StickyListPage from '@shared/stickyListPage';
import { useModelRefresh, useServerListState } from '@shared/serverList';
import { useI18n } from '@i18n/i18n';
import manifest from './manifest.json';
import type { InterfaceIndexData, InterfaceIndexPayload, InterfaceRow, InterfaceSortBy } from './interface.types';

const { Search } = Input;
const { Title } = Typography;
const runtime = createModelRuntime(manifest);
const editPath = requireModelViewPath(manifest.model, 'edit');

export default function InterfacePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [rows, setRows] = useState<InterfaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'true' | 'false'>('all');
  const listState = useServerListState<InterfaceRow, InterfaceSortBy>({
    initialSortBy: 'code',
    initialPageSize: 20,
  });

  const loadRows = async (params?: Partial<InterfaceIndexPayload>) => {
    const nextSearch = params?.search ?? search;
    const nextFilter = params?.isActive === undefined
      ? activityFilter
      : params.isActive === null
      ? 'all'
      : params.isActive
      ? 'true'
      : 'false';
    const requestedQuery = listState.buildQuery({
      page: params?.page,
      pageSize: params?.pageSize,
      sortBy: params?.sortBy,
      sortDirection: params?.sortDirection,
    });

    setLoading(true);
    try {
      const response = await runtime.index<InterfaceIndexData, InterfaceIndexPayload>({
        search: nextSearch || undefined,
        isActive: nextFilter === 'all' ? null : nextFilter === 'true',
        page: requestedQuery.page,
        pageSize: requestedQuery.pageSize,
        sortBy: requestedQuery.sortBy,
        sortDirection: requestedQuery.sortDirection,
      });
      if (response.ok) {
        setRows(response.data.rows);
        listState.applyResponseTotals(response.data.totals, requestedQuery);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('interface.loadError'));
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

  const columns: ColumnsType<InterfaceRow> = [
    {
      title: t('interface.code'),
      dataIndex: 'code',
      key: 'code',
      width: 180,
      sorter: true,
      sortOrder: listState.getSortOrder('code'),
    },
    {
      title: t('interface.name'),
      dataIndex: 'name',
      key: 'name',
      sorter: true,
      sortOrder: listState.getSortOrder('name'),
    },
    {
      title: t('interface.menuCount'),
      dataIndex: 'menuCount',
      key: 'menuCount',
      width: 140,
      sorter: true,
      sortOrder: listState.getSortOrder('menuCount'),
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
      width: 100,
      render: (_: unknown, row: InterfaceRow) => (
        <Button className="app-icon-button" icon={<EditOutlined />} onClick={() => navigate(`${editPath}?id=${row.id}`)} />
      ),
    },
  ];

  return (
    <StickyListPage>
      <div className="app-list-page__sticky-header">
        <Title className="app-section-title" level={3} style={{ margin: '0 0 16px' }}>{t('interface.titleMany')}</Title>

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
                value={activityFilter}
                onChange={(value) => {
                  setActivityFilter(value);
                  void loadRows({ isActive: value === 'all' ? null : value === 'true', page: 1 });
                }}
                style={{ width: 180 }}
                options={[
                  { value: 'all', label: t('interface.allStates') },
                  { value: 'true', label: t('interface.activeStates') },
                  { value: 'false', label: t('interface.inactiveStates') },
                ]}
              />
            </div>
          </div>

          <div className="app-toolbar__search">
            <Search
              placeholder={t('interface.searchPlaceholder')}
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
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={loading}
        onRow={(row) => ({ onDoubleClick: () => navigate(`${editPath}?id=${row.id}`) })}
        onChange={listState.tableOnChange((nextQuery) => { void loadRows(nextQuery); })}
        pagination={listState.paginationConfig}
      />
    </StickyListPage>
  );
}
