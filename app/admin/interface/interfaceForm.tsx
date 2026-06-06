import { Col, Form, Input, Row, Select, Switch } from 'antd';
import type { FormInstance } from 'antd';
import { useI18n } from '@i18n/i18n';
import type { InterfaceItem, LookupOption } from './interface.types';

interface InterfaceFormProps {
  form: FormInstance<InterfaceItem>;
  menuOptions: LookupOption[];
  onFinish: (values: InterfaceItem) => void;
}

export default function InterfaceForm({ form, menuOptions, onFinish }: InterfaceFormProps) {
  const { t } = useI18n();

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item
            name="code"
            label={t('interface.code')}
            rules={[{ required: true, message: t('interface.required.code') }]}
          >
            <Input maxLength={100} />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="name"
            label={t('interface.name')}
            rules={[{ required: true, message: t('interface.required.name') }]}
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

      <Form.Item
        name="menuIds"
        label={t('interface.menus')}
        rules={[{ required: true, type: 'array', min: 1, message: t('interface.required.menus') }]}
      >
        <Select
          mode="multiple"
          allowClear
          showSearch
          optionFilterProp="label"
          options={menuOptions}
          placeholder={t('interface.menusPlaceholder')}
        />
      </Form.Item>
    </Form>
  );
}