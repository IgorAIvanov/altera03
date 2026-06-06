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
import UserGroupForm from './userGroupForm';
import type { LookupOption, UserGroupItem, UserGroupLoadData, UserGroupLoadPayload, UserGroupUpdateData, UserGroupUpdatePayload } from './user_group.types';

const runtime = createModelRuntime(manifest);
const listPath = requireModelViewPath(manifest.model, 'list');
const editPath = requireModelViewPath(manifest.model, 'edit');

const emptyItem: UserGroupItem = {
  id: null,
  code: '',
  name: '',
  isActive: true,
  interfaceIds: [],
  userIds: [],
};

function buildTitle(item: Partial<UserGroupItem>, fallback: string) {
  const parts = [item.code?.trim(), item.name?.trim()].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : fallback;
}

export default function UserGroupCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { message } = App.useApp();
  const [form] = Form.useForm<UserGroupItem>();
  const [interfaceOptions, setInterfaceOptions] = useState<LookupOption[]>([]);
  const [userOptions, setUserOptions] = useState<LookupOption[]>([]);
  const [saving, setSaving] = useState(false);
  const loadedId = searchParams.get('id') ?? undefined;
  const isNew = !loadedId;
  const pageTitle = isNew ? t('userGroup.newTitle') : t('userGroup.editTitle');
  const currentPath = `${location.pathname}${location.search}`;
  const { item, setItem, loading, loadError } = useModelCard<
    UserGroupItem,
    UserGroupLoadData,
    UserGroupLoadPayload | Record<string, never>
  >({
    form,
    runtime,
    loadedId,
    emptyItem,
    currentPath,
    isNew,
    newTitle: t('userGroup.newTitle'),
    singularTitle: t('userGroup.titleOne'),
    notFoundMessage: t('userGroup.notFound'),
    loadErrorMessage: t('userGroup.loadOneError'),
    loadOnNew: true,
    buildTitle,
    getLoadPayload: (id) => (id ? { id } : {}) as UserGroupLoadPayload | Record<string, never>,
    mapResponseToItem: (data, fallbackItem, nextIsNew) => {
      if (nextIsNew) {
        return fallbackItem;
      }

      return data.item;
    },
    onLoadData: (data) => {
      setInterfaceOptions(data.lookups.interfaces ?? []);
      setUserOptions(data.lookups.users ?? []);
    },
  });

  const saveItem = async (values: UserGroupItem, closeAfterSave = false) => {
    try {
      setSaving(true);
      const payload: UserGroupItem = {
        ...item,
        ...values,
        code: values.code.trim(),
        name: values.name.trim(),
        isActive: values.isActive ?? true,
        interfaceIds: values.interfaceIds ?? [],
        userIds: values.userIds ?? [],
      };

      const response = await runtime.update<UserGroupUpdateData, UserGroupUpdatePayload>({ item: payload });
      if (!response.ok || !response.data.item?.id) {
        message.error(t('userGroup.saveError'));
        return;
      }

      const savedItem = {
        ...payload,
        id: response.data.item.id,
      };
      const nextTitle = buildTitle(savedItem, t('userGroup.titleOne'));
      setItem(savedItem);
      form.setFieldsValue(savedItem);
      message.success(t('userGroup.saveSuccess'));
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
      message.error(error instanceof Error ? error.message : t('userGroup.saveError'));
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
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>{t('common.save')}</Button>
            <Button icon={<SaveOutlined />} loading={saving} onClick={() => void form.validateFields().then((values) => saveItem(values, true))}>{t('common.saveAndClose')}</Button>
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
          title={t('userGroup.loadOneError')}
          description={loadError}
          action={(
            <Space>
              {!isNew && <Button size="small" onClick={() => navigate(0)}>{t('app.retry')}</Button>}
              <Button size="small" onClick={() => navigate(listPath)}>{t('userGroup.backToList')}</Button>
            </Space>
          )}
        />
      ) : (
        <Card className="app-panel-card" size="small" styles={{ body: { paddingBottom: 12 } }}>
          <Spin spinning={loading}>
            <UserGroupForm
              form={form}
              interfaceOptions={interfaceOptions}
              userOptions={userOptions}
              onFinish={(values) => void saveItem(values)}
            />
          </Spin>
        </Card>
      )}
    </div>
  );
}