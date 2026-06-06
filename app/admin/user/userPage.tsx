import { useEffect, useState } from 'react';
import { App, Button, Input, Select, Table, Tag, Typography } from 'antd';
import { EditOutlined, FileExcelOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table/interface';
import { useNavigate } from 'react-router-dom';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { requireModelViewPath } from '@shared/featureNavigation';
import { downloadModelExportFile, type ModelExportFileData } from '@shared/modelExport';
import StickyListPage from '@shared/stickyListPage';
import { useModelRefresh, useServerListState } from '@shared/serverList';
import { useI18n } from '@i18n/i18n';
import manifest from './manifest.json';
import type { UserIndexData, UserIndexPayload, UserRow, UserSortBy } from './user.types';

const { Search } = Input;
const { Title } = Typography;
const runtime = createModelRuntime(manifest);
const editPath = requireModelViewPath(manifest.model, 'edit');

export default function UserPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'true' | 'false'>('all');
  const listState = useServerListState<UserRow, UserSortBy>({ initialSortBy: 'login', initialPageSize: 20 });

  const buildIndexPayload = (params?: Partial<UserIndexPayload>): UserIndexPayload => {
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

    return {
      search: nextSearch || undefined,
      isActive: nextFilter === 'all' ? null : nextFilter === 'true',
      page: requestedQuery.page,
      pageSize: requestedQuery.pageSize,
      sortBy: requestedQuery.sortBy,
      sortDirection: requestedQuery.sortDirection,
    };
  };

  const loadRows = async (params?: Partial<UserIndexPayload>) => {
    const requestedPayload = buildIndexPayload(params);

    setLoading(true);
    try {
      const response = await runtime.index<UserIndexData, UserIndexPayload>(requestedPayload);
      if (response.ok) {
        setRows(response.data.rows);
        listState.applyResponseTotals(response.data.totals, {
          page: requestedPayload.page ?? 1,
          pageSize: requestedPayload.pageSize ?? 20,
          sortBy: requestedPayload.sortBy ?? listState.query.sortBy,
          sortDirection: requestedPayload.sortDirection ?? listState.query.sortDirection,
        });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('user.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useModelRefresh(manifest.model, () => {
    void loadRows();
  });

  const exportRows = async () => {
    setExporting(true);
    try {
      const response = await runtime.command<ModelExportFileData, UserIndexPayload>('exportExcel', buildIndexPayload());
      if (!response.ok) {
        message.error(response.messages[0] ?? t('user.loadError'));
        return;
      }

      downloadModelExportFile(response.data.extra);
      if (response.messages[0]) {
        message.warning(response.messages[0]);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('user.loadError'));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    void loadRows();
  }, []);

  const columns: ColumnsType<UserRow> = [
    { title: t('user.login'), dataIndex: 'login', key: 'login', width: 180, sorter: true, sortOrder: listState.getSortOrder('login') },
    { title: t('user.fullName'), dataIndex: 'fullName', key: 'fullName', sorter: true, sortOrder: listState.getSortOrder('fullName') },
    { title: t('user.groupCount'), dataIndex: 'groupCount', key: 'groupCount', width: 120, sorter: true, sortOrder: listState.getSortOrder('groupCount') },
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
      render: (_: unknown, row: UserRow) => <Button className="app-icon-button" icon={<EditOutlined />} onClick={() => navigate(`${editPath}?id=${row.id}`)} />,
    },
  ];

  return (
    <StickyListPage>
      <div className="app-list-page__sticky-header">
        <Title className="app-section-title" level={3} style={{ margin: '0 0 16px' }}>{t('user.titleMany')}</Title>
        <div className="app-toolbar" style={{ marginBottom: 16 }}>
          <div className="app-toolbar__actions">
            <div className="app-toolbar__group">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(editPath)}>{t('common.add')}</Button>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadRows()}>{t('common.refresh')}</Button>
            </div>
            <div className="app-toolbar__group">
              <Button
                className="app-excel-export-button"
                icon={<span className="app-excel-export-button__icon"><FileExcelOutlined /></span>}
                loading={exporting}
                onClick={() => void exportRows()}
              >
                Вигрузити
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
                  { value: 'all', label: t('user.allStates') },
                  { value: 'true', label: t('user.activeStates') },
                  { value: 'false', label: t('user.inactiveStates') },
                ]}
              />
            </div>
          </div>
          <div className="app-toolbar__search">
            <Search
              placeholder={t('user.searchPlaceholder')}
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
