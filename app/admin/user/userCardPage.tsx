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
import UserForm from './userForm';
import type { LookupOption, UserItem, UserLoadData, UserLoadPayload, UserUpdateData, UserUpdatePayload } from './user.types';

const runtime = createModelRuntime(manifest);
const listPath = requireModelViewPath(manifest.model, 'list');
const editPath = requireModelViewPath(manifest.model, 'edit');

const emptyItem: UserItem = {
  id: null,
  login: '',
  fullName: '',
  password: '',
  isActive: true,
  groupIds: [],
};

function buildTitle(item: Partial<UserItem>, fallback: string) {
  const parts = [item.login?.trim(), item.fullName?.trim()].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(' · ') : fallback;
}

function resolveModelError(messages: string[] | undefined, fallback: string) {
  const firstMessage = messages?.find((message) => typeof message === 'string' && message.trim());
  return firstMessage ?? fallback;
}

export default function UserCardPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const { message } = App.useApp();
  const [form] = Form.useForm<UserItem>();
  const [groupOptions, setGroupOptions] = useState<LookupOption[]>([]);
  const [saving, setSaving] = useState(false);
  const loadedId = searchParams.get('id') ?? undefined;
  const isNew = !loadedId;
  const pageTitle = isNew ? t('user.newTitle') : t('user.editTitle');
  const currentPath = `${location.pathname}${location.search}`;
  const { item, setItem, loading, loadError } = useModelCard<
    UserItem,
    UserLoadData,
    UserLoadPayload | Record<string, never>
  >({
    form,
    runtime,
    loadedId,
    emptyItem,
    currentPath,
    isNew,
    newTitle: t('user.newTitle'),
    singularTitle: t('user.titleOne'),
    notFoundMessage: t('user.notFound'),
    loadErrorMessage: t('user.loadOneError'),
    loadOnNew: true,
    buildTitle,
    getLoadPayload: (id) => (id ? { id } : {}) as UserLoadPayload | Record<string, never>,
    mapResponseToItem: (data, fallbackItem, nextIsNew) => {
      if (nextIsNew) {
        return fallbackItem;
      }

      if (!data.item) {
        return null;
      }

      return {
        ...data.item,
        password: '',
      };
    },
    onLoadData: (data) => {
      setGroupOptions(data.lookups.groups ?? []);
    },
  });

  const saveItem = async (values: UserItem, closeAfterSave = false) => {
    try {
      setSaving(true);
      const payload: UserItem = {
        ...item,
        ...values,
        login: values.login.trim(),
        fullName: values.fullName.trim(),
        password: values.password,
        isActive: values.isActive ?? true,
        groupIds: values.groupIds ?? [],
      };

      const response = await runtime.command<UserUpdateData, UserUpdatePayload>('update', { item: payload });
      if (!response.ok || !response.data.item?.id) {
        message.error(resolveModelError(response.messages, t('user.saveError')));
        return;
      }

      const savedItem = {
        ...payload,
        id: response.data.item.id,
        password: '',
      };
      const nextTitle = buildTitle(savedItem, t('user.titleOne'));
      setItem(savedItem);
      form.setFieldsValue(savedItem);
      message.success(t('user.saveSuccess'));
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
      form.setFieldValue('password', '');
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('user.saveError'));
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
          title={t('user.loadOneError')}
          description={loadError}
          action={(
            <Space>
              {!isNew && <Button size="small" onClick={() => navigate(0)}>{t('app.retry')}</Button>}
              <Button size="small" onClick={() => navigate(listPath)}>{t('user.backToList')}</Button>
            </Space>
          )}
        />
      ) : (
        <Card className="app-panel-card" size="small" styles={{ body: { paddingBottom: 12 } }}>
          <Spin spinning={loading}>
            <UserForm
              form={form}
              isNew={isNew}
              groupOptions={groupOptions}
              onFinish={(values) => void saveItem(values)}
            />
          </Spin>
        </Card>
      )}
    </div>
  );
}