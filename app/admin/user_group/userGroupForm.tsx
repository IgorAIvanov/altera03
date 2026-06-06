import { Col, Form, Input, Row, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { useI18n } from '@i18n/i18n';
import type { LookupOption, UserGroupItem } from './user_group.types';

interface UserGroupFormProps {
  form: FormInstance<UserGroupItem>;
  interfaceOptions: LookupOption[];
  userOptions: LookupOption[];
  onFinish: (values: UserGroupItem) => void;
}

export default function UserGroupForm({ form, interfaceOptions, userOptions, onFinish }: UserGroupFormProps) {
  const { t } = useI18n();

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item
            name="code"
            label={t('userGroup.code')}
            rules={[{ required: true, message: t('userGroup.required.code') }]}
          >
            <Input maxLength={100} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="name"
            label={t('userGroup.name')}
            rules={[{ required: true, message: t('userGroup.required.name') }]}
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

      <Form.Item name="interfaceIds" label={t('userGroup.interfaces')}>
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          options={interfaceOptions}
          placeholder={t('userGroup.interfacesPlaceholder')}
        />
      </Form.Item>

      <Form.Item name="userIds" label={t('userGroup.users')}>
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          options={userOptions}
          placeholder={t('userGroup.usersPlaceholder')}
        />
      </Form.Item>
    </Form>
  );
}