import { useState } from 'react';
import { Alert, App, Button, Card, Form, Space, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CardPageHeader } from '@shared/cardPageHeader';
import { createModelRuntime } from '@shared/modelRuntime.api';
import { useModelCard } from '@shared/modelCard';
import { requireModelViewPath } from '@shared/featureNavigation';
import { closeWorkspaceTab, emitWorkspaceTabTitle, replaceWorkspaceTabPath } from '@shared/workspaceTabs';
import { publishModelSaved } from '@shared/workspaceEvents';
import { useI18n } from '@i18n/i18n';
import manifest from './manifest.json';
import InterfaceForm from './interfaceForm';
import type { InterfaceItem, InterfaceLoadData, InterfaceLoadPayload, InterfaceUpdateData, InterfaceUpdatePayload } from './interface.types';

const runtime = createModelRuntime(manifest);
const listPath = requireModelViewPath(manifest.model, 'list');
const editPath = requireModelViewPath(manifest.model, 'edit');

const emptyItem: InterfaceItem = {
  id: null,
  code: '',
  name: '',
  isActive: true,
  menuIds: [],
};

function buildTitle(item: Partial<InterfaceItem>, fallback: string) {
  const parts = [item.code?.trim(), item.name?.trim()].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : fallback;
}

export default function InterfaceCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { message } = App.useApp();
  const [form] = Form.useForm<InterfaceItem>();
  const [menuOptions, setMenuOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const loadedId = searchParams.get('id') ?? undefined;
  const isNew = !loadedId;
  const pageTitle = isNew ? t('interface.newTitle') : t('interface.editTitle');
  const currentPath = `${location.pathname}${location.search}`;
  const { item, setItem, loading, loadError } = useModelCard<
    InterfaceItem,
    InterfaceLoadData,
    InterfaceLoadPayload | Record<string, never>
  >({
    form,
    runtime,
    loadedId,
    emptyItem,
    currentPath,
    isNew,
    newTitle: t('interface.newTitle'),
    singularTitle: t('interface.titleOne'),
    notFoundMessage: t('interface.notFound'),
    loadErrorMessage: t('interface.loadOneError'),
    loadOnNew: true,
    buildTitle,
    getLoadPayload: (id) => (id ? { id } : {}) as InterfaceLoadPayload | Record<string, never>,
    mapResponseToItem: (data, fallbackItem, nextIsNew) => {
      if (nextIsNew) {
        return fallbackItem;
      }

      if (!data.item) {
        return null;
      }

      return {
        ...data.item,
        menuIds: data.rows.map((row) => row.menuId),
      };
    },
    onLoadData: (data) => {
      setMenuOptions(data.lookups.menus ?? []);
    },
  });

  const saveItem = async (values: InterfaceItem, closeAfterSave = false) => {
    try {
      setSaving(true);
      const payload: InterfaceItem = {
        ...item,
        ...values,
        code: values.code.trim(),
        name: values.name.trim(),
        menuIds: values.menuIds ?? [],
        isActive: values.isActive ?? true,
      };

      const response = await runtime.update<InterfaceUpdateData, InterfaceUpdatePayload>({
        item: {
          id: payload.id,
          code: payload.code,
          name: payload.name,
          isActive: payload.isActive,
        },
        rows: payload.menuIds.map((menuId, index) => ({
          menuId,
          sortOrder: (index + 1) * 10,
          isActive: true,
        })),
      });

      if (!response.ok || !response.data.item?.id) {
        message.error(t('interface.saveError'));
        return;
      }

      const savedItem: InterfaceItem = {
        ...payload,
        id: response.data.item.id,
      };
      const nextTitle = buildTitle(savedItem, t('interface.titleOne'));
      setItem(savedItem);
      form.setFieldsValue(savedItem);
      message.success(t('interface.saveSuccess'));
      publishModelSaved(manifest.model, savedItem.id, currentPath);

      if (closeAfterSave) {
        closeWorkspaceTab(currentPath);
        return;
      }

      if (isNew) {
        const nextPath = `${editPath}?id=${savedItem.id}`;
        replaceWorkspaceTabPath(currentPath, nextPath, nextTitle);
        navigate(nextPath, { replace: true });
        return;
      }

      emitWorkspaceTabTitle(currentPath, nextTitle);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('interface.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-card-page">
      <CardPageHeader
        title={pageTitle}
        actions={(
          <>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>
            {t('common.save')}
          </Button>
          <Button icon={<SaveOutlined />} loading={saving} onClick={() => void form.validateFields().then((values) => saveItem(values, true))}>
            {t('common.saveAndClose')}
          </Button>
          <Button onClick={() => { closeWorkspaceTab(currentPath); }}>
            Закрити
          </Button>
          </>
        )}
      />

      {loadError ? (
        <Alert
          className="app-inline-alert"
          type="error"
          showIcon
          title={t('interface.loadOneError')}
          description={loadError}
          action={(
            <Space>
              {!isNew && <Button size="small" onClick={() => navigate(0)}>{t('app.retry')}</Button>}
              <Button size="small" onClick={() => navigate(listPath)}>{t('interface.backToList')}</Button>
            </Space>
          )}
        />
      ) : (
        <Card className="app-panel-card" size="small" styles={{ body: { paddingBottom: 12 } }}>
          <Spin spinning={loading}>
            <InterfaceForm
              form={form}
              menuOptions={menuOptions}
              onFinish={(values) => void saveItem(values)}
            />
          </Spin>
        </Card>
      )}
    </div>
  );
}