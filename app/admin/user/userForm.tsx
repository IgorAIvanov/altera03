import { Col, Form, Input, Row, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { useI18n } from '@i18n/i18n';
import type { LookupOption, UserItem } from './user.types';

interface UserFormProps {
  form: FormInstance<UserItem>;
  isNew: boolean;
  groupOptions: LookupOption[];
  onFinish: (values: UserItem) => void;
}

export default function UserForm({ form, isNew, groupOptions, onFinish }: UserFormProps) {
  const { t } = useI18n();

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item
            name="login"
            label={t('user.login')}
            rules={[{ required: true, message: t('user.required.login') }]}
          >
            <Input maxLength={100} autoComplete="username" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="fullName"
            label={t('user.fullName')}
            rules={[{ required: true, message: t('user.required.fullName') }]}
          >
            <Input maxLength={255} />
          </Form.Item>
        </Col>
        <Col xs={24} md={4}>
          <Form.Item name="isActive" label={t('common.active')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="password"
            label={isNew ? t('user.password') : t('user.passwordChange')}
            rules={isNew ? [{ required: true, message: t('user.required.password') }] : undefined}
            extra={isNew ? undefined : t('user.passwordHint')}
          >
            <Input.Password autoComplete={isNew ? 'new-password' : 'off'} />
          </Form.Item>
        </Col>
      </Row>

      <Form.Item name="groupIds" label={t('user.groups')}>
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          options={groupOptions}
          placeholder={t('user.groupsPlaceholder')}
        />
      </Form.Item>
    </Form>
  );
}