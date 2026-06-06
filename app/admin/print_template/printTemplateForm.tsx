import { App, Button, Card, Checkbox, Col, Dropdown, Form, Input, Row, Select, Space, Table } from 'antd';
import type { FormInstance } from 'antd';
import { DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useI18n } from '@i18n/i18n';
import type {
  LookupOption,
  PrintTemplateBlock,
  PrintTemplateFieldListItem,
  PrintTemplateItem,
  PrintTemplateTableColumnItem,
} from './printTemplate.types';
import {
  createPrintTemplateBlock,
} from './printTemplate.types';

interface PrintTemplateFormProps {
  form: FormInstance<PrintTemplateItem>;
  showDetailedBlockEditors?: boolean;
  showAddBlockControl?: boolean;
  schemaBlocks: PrintTemplateBlock[];
  onSchemaBlocksChange: (blocks: PrintTemplateBlock[]) => void;
  orientationOptions: LookupOption[];
  columnAlignmentOptions: LookupOption[];
  onFinish: (values: PrintTemplateItem) => void;
  onValuesChange?: (changedValues: Partial<PrintTemplateItem>, allValues: PrintTemplateItem) => void;
}

export default function PrintTemplateForm({
  form,
  showDetailedBlockEditors = true,
  showAddBlockControl = true,
  schemaBlocks,
  onSchemaBlocksChange,
  orientationOptions,
  columnAlignmentOptions,
  onFinish,
  onValuesChange,
}: PrintTemplateFormProps) {
  const { t } = useI18n();
  const { message } = App.useApp();
  // schemaBlocks is passed in as state from PrintTemplateCardPage.
  // This ensures add/remove/edit block buttons are always reactive.
  const renderBlocks = schemaBlocks;

  const getCurrentBlocks = (): PrintTemplateBlock[] => schemaBlocks;

  const updateSchemaBlocks = (nextBlocks: PrintTemplateBlock[]) => {
    onSchemaBlocksChange(nextBlocks);
  };

  const addBlockMenuItems = [
    {
      key: 'text',
      label: t('printTemplate.addTextBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('text')]),
    },
    {
      key: 'field-list',
      label: t('printTemplate.addFieldListBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('field-list')]),
    },
    {
      key: 'table',
      label: t('printTemplate.addTableBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('table')]),
    },
    {
      key: 'image',
      label: t('printTemplate.addImageBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('image')]),
    },
    {
      key: 'horizontal-line',
      label: t('printTemplate.addHorizontalLineBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('horizontal-line')]),
    },
    {
      key: 'vertical-line',
      label: t('printTemplate.addVerticalLineBlock'),
      onClick: () => updateSchemaBlocks([...getCurrentBlocks(), createPrintTemplateBlock('vertical-line')]),
    },
  ];

  const selectImageFile = (blockIndex: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }

      if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
        message.error(t('printTemplate.imageUploadError'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => message.error(t('printTemplate.imageUploadError'));
      reader.onload = () => {
        const imageSrc = reader.result;
        if (typeof imageSrc !== 'string') {
          message.error(t('printTemplate.imageUploadError'));
          return;
        }

        const currentBlocks = getCurrentBlocks();
        updateSchemaBlocks(currentBlocks.map((entry, index) => {
          if (index !== blockIndex || entry.type !== 'image') {
            return entry;
          }

          return {
            ...entry,
            src: imageSrc,
          };
        }));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const removeFieldItem = (blockIndex: number, itemKey: string) => {
    const currentBlocks = getCurrentBlocks();
    const block = currentBlocks[blockIndex];
    const items = block?.type === 'field-list' ? block.items : [];
    updateSchemaBlocks(currentBlocks.map((entry: PrintTemplateBlock, index: number) => {
      if (index !== blockIndex || entry.type !== 'field-list') {
        return entry;
      }

      return {
        ...entry,
        items: items.filter((item: PrintTemplateFieldListItem) => item.key !== itemKey),
      };
    }));
  };

  const addFieldItem = (blockIndex: number) => {
    const currentBlocks = getCurrentBlocks();
    const block = currentBlocks[blockIndex];
    const items = block?.type === 'field-list' ? block.items : [];
    updateSchemaBlocks(currentBlocks.map((entry: PrintTemplateBlock, index: number) => {
      if (index !== blockIndex || entry.type !== 'field-list') {
        return entry;
      }

      return {
        ...entry,
        items: [...items, { key: crypto.randomUUID(), label: '', path: '' }],
      };
    }));
  };

  const removeTableColumn = (blockIndex: number, columnKey: string) => {
    const currentBlocks = getCurrentBlocks();
    const block = currentBlocks[blockIndex];
    const columns = block?.type === 'table' ? block.columns : [];
    updateSchemaBlocks(currentBlocks.map((entry: PrintTemplateBlock, index: number) => {
      if (index !== blockIndex || entry.type !== 'table') {
        return entry;
      }

      return {
        ...entry,
        columns: columns.filter((column) => column.key !== columnKey),
      };
    }));
  };

  const addTableColumn = (blockIndex: number) => {
    const currentBlocks = getCurrentBlocks();
    const block = currentBlocks[blockIndex];
    const columns = block?.type === 'table' ? block.columns : [];
    updateSchemaBlocks(currentBlocks.map((entry: PrintTemplateBlock, index: number) => {
      if (index !== blockIndex || entry.type !== 'table') {
        return entry;
      }

      return {
        ...entry,
        columns: [...columns, {
          key: crypto.randomUUID(),
          title: '',
          path: '',
          widthPercent: '20',
          headerAlign: 'left',
          headerFontWeight: 'bold',
          headerFontSize: '',
          headerColor: '',
          valueAlign: 'left',
          valueFontWeight: 'normal',
          valueFontSize: '',
          valueColor: '',
        }],
      };
    }));
  };

  return (
    <Form<PrintTemplateItem>
      form={form}
      layout="vertical"
      onFinish={onFinish}
      onValuesChange={onValuesChange}
      initialValues={{
        paperSize: 'A4',
        orientation: 'portrait',
        isDefault: false,
        isActive: true,
      }}
    >
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label={t('printTemplate.code')} name="code" rules={[{ required: true, message: t('printTemplate.required.code') }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={16}>
          <Form.Item label={t('printTemplate.name')} name="name" rules={[{ required: true, message: t('printTemplate.required.name') }]}>
            <Input />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label={t('printTemplate.targetModel')} name="targetModel" rules={[{ required: true, message: t('printTemplate.required.targetModel') }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label={t('printTemplate.dataCommand')} name="dataCommand" rules={[{ required: true, message: t('printTemplate.required.dataCommand') }]}>
            <Input />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label={t('printTemplate.paperSize')} name="paperSize">
            <Input disabled />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label={t('printTemplate.orientation')} name="orientation">
            <Select options={orientationOptions} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col xs={24} md={6}>
          <Form.Item name="isDefault" valuePropName="checked">
            <Checkbox>{t('printTemplate.isDefault')}</Checkbox>
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item name="isActive" valuePropName="checked">
            <Checkbox>{t('common.active')}</Checkbox>
          </Form.Item>
        </Col>
      </Row>

      <Form.Item hidden name={['schema', 'schemaVersion']} initialValue={2}>
        <Input />
      </Form.Item>

      <Form.Item label={t('printTemplate.blocks')}>
        {showAddBlockControl ? (
          <Dropdown trigger={['click']} menu={{ items: addBlockMenuItems }}>
            <Button icon={<PlusOutlined />} style={{ marginBottom: 8 }}>
              {t('printTemplate.addBlock')}
            </Button>
          </Dropdown>
        ) : null}

        <Space orientation="vertical" size={12} style={{ width: '100%' }}>
          {!showDetailedBlockEditors ? (
            <div style={{ color: '#8c8c8c', fontSize: 12, padding: '4px 0 0' }}>
              {t('printTemplate.blocksEditorHint')}
            </div>
          ) : null}

          {showDetailedBlockEditors ? renderBlocks.map((block, blockIndex) => {
            const blockType = block.type;
            const fieldItems = blockType === 'field-list' && Array.isArray(block.items) ? block.items : [];
            const tableColumns = blockType === 'table' && Array.isArray(block.columns) ? block.columns : [];

            return (
            <Card
              key={block.key}
              size="small"
              title={t(`printTemplate.blockTypeOptions.${blockType}`)}
              extra={(
                <Space wrap>
                  <Button danger icon={<DeleteOutlined />} onClick={() => updateSchemaBlocks(getCurrentBlocks().filter((_, index) => index !== blockIndex))} />
                </Space>
              )}
            >
              <Form.Item hidden name={['schema', 'blocks', blockIndex, 'key']}>
                <Input />
              </Form.Item>
              <Form.Item hidden name={['schema', 'blocks', blockIndex, 'type']}>
                <Input />
              </Form.Item>

                  <Row gutter={12} style={{ marginBottom: 12 }}>
                    <Col xs={24} md={blockType === 'image' ? 6 : 8}>
                      <Form.Item label={t('printTemplate.placementXPercent')} name={['schema', 'blocks', blockIndex, 'placement', 'xPercent']} style={{ marginBottom: 0 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={blockType === 'image' ? 6 : 8}>
                      <Form.Item label={t('printTemplate.placementYPercent')} name={['schema', 'blocks', blockIndex, 'placement', 'yPercent']} style={{ marginBottom: 0 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={blockType === 'image' ? 6 : 8}>
                      <Form.Item label={t('printTemplate.placementWidthPercent')} name={['schema', 'blocks', blockIndex, 'placement', 'widthPercent']} style={{ marginBottom: 0 }}>
                        <Input />
                      </Form.Item>
                    </Col>
                    {blockType === 'image' ? (
                      <Col xs={24} md={6}>
                        <Form.Item label={t('printTemplate.placementHeightPercent')} name={['schema', 'blocks', blockIndex, 'placement', 'heightPercent']} style={{ marginBottom: 0 }}>
                          <Input />
                        </Form.Item>
                      </Col>
                    ) : null}
                  </Row>

                  {blockType !== 'image' ? (
                    <Row gutter={12} style={{ marginBottom: 12 }}>
                      <Col xs={24} md={8}>
                        <Form.Item label={t('printTemplate.fontSize')} name={['schema', 'blocks', blockIndex, 'text', 'fontSize']} style={{ marginBottom: 0 }}>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item label={t('printTemplate.fontAlign')} name={['schema', 'blocks', blockIndex, 'text', 'align']} style={{ marginBottom: 0 }}>
                          <Select options={columnAlignmentOptions} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item label={t('printTemplate.fontWeight')} name={['schema', 'blocks', blockIndex, 'text', 'fontWeight']} style={{ marginBottom: 0 }}>
                          <Select
                            options={[
                              { value: 'normal', label: t('printTemplate.fontWeightOptions.normal') },
                              { value: 'bold', label: t('printTemplate.fontWeightOptions.bold') },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : null}

                  {blockType === 'text' ? (
                    <Row gutter={12}>
                      <Col xs={24} md={8}>
                        <Form.Item label={t('printTemplate.textStyle')} name={['schema', 'blocks', blockIndex, 'style']} style={{ marginBottom: 0 }}>
                          <Select
                            options={[
                              { value: 'title', label: t('printTemplate.textStyleOptions.title') },
                              { value: 'section', label: t('printTemplate.textStyleOptions.section') },
                              { value: 'body', label: t('printTemplate.textStyleOptions.body') },
                            ]}
                          />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={16}>
                        <Form.Item label={t('printTemplate.textValue')} name={['schema', 'blocks', blockIndex, 'value']} style={{ marginBottom: 0 }}>
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : null}

                  {blockType === 'field-list' ? (
                    <>
                      <Space style={{ marginBottom: 8 }}>
                        <Button icon={<PlusOutlined />} onClick={() => addFieldItem(blockIndex)}>
                          {t('printTemplate.addFieldItem')}
                        </Button>
                      </Space>
                      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                        {fieldItems.map((item: PrintTemplateFieldListItem, itemIndex: number) => (
                          <Row key={item.key || `${block.key}-${itemIndex + 1}`} gutter={8} align="middle">
                            <Form.Item hidden name={['schema', 'blocks', blockIndex, 'items', itemIndex, 'key']}>
                              <Input />
                            </Form.Item>
                            <Col xs={24} md={10}>
                              <Form.Item label={t('printTemplate.fieldLabel')} name={['schema', 'blocks', blockIndex, 'items', itemIndex, 'label']} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={12}>
                              <Form.Item label={t('printTemplate.fieldPath')} name={['schema', 'blocks', blockIndex, 'items', itemIndex, 'path']} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                            </Col>
                            <Col xs={24} md={2}>
                              <Button danger icon={<DeleteOutlined />} onClick={() => removeFieldItem(blockIndex, item.key)} />
                            </Col>
                          </Row>
                        ))}
                      </Space>
                    </>
                  ) : null}

                  {blockType === 'table' ? (
                    <>
                      <Row gutter={12}>
                        <Col xs={24} md={12}>
                          <Form.Item label={t('printTemplate.tableTitle')} name={['schema', 'blocks', blockIndex, 'title']}>
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item label={t('printTemplate.tableSource')} name={['schema', 'blocks', blockIndex, 'source']}>
                            <Input />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Space style={{ marginBottom: 8 }}>
                        <Button icon={<PlusOutlined />} onClick={() => addTableColumn(blockIndex)}>
                          {t('printTemplate.addTableColumn')}
                        </Button>
                      </Space>
                      <Table
                        size="small"
                        rowKey={(record) => (record as PrintTemplateTableColumnItem).key}
                        pagination={false}
                        dataSource={tableColumns}
                        columns={[
                          {
                            title: t('printTemplate.columnTitle'),
                            render: (_, __, columnIndex) => (
                              <>
                                <Form.Item hidden name={['schema', 'blocks', blockIndex, 'columns', columnIndex, 'key']}>
                                  <Input />
                                </Form.Item>
                                <Form.Item name={['schema', 'blocks', blockIndex, 'columns', columnIndex, 'title']} style={{ marginBottom: 0 }}>
                                  <Input />
                                </Form.Item>
                              </>
                            ),
                          },
                          {
                            title: t('printTemplate.columnPath'),
                            render: (_, __, columnIndex) => (
                              <Form.Item name={['schema', 'blocks', blockIndex, 'columns', columnIndex, 'path']} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                            ),
                          },
                          {
                            title: t('printTemplate.columnWidthPercent'),
                            width: 120,
                            render: (_, __, columnIndex) => (
                              <Form.Item name={['schema', 'blocks', blockIndex, 'columns', columnIndex, 'widthPercent']} style={{ marginBottom: 0 }}>
                                <Input />
                              </Form.Item>
                            ),
                          },
                          {
                            title: t('printTemplate.columnAlign'),
                            width: 140,
                            render: (_, __, columnIndex) => (
                              <Form.Item name={['schema', 'blocks', blockIndex, 'columns', columnIndex, 'align']} style={{ marginBottom: 0 }}>
                                <Select options={columnAlignmentOptions} />
                              </Form.Item>
                            ),
                          },
                          {
                            title: t('common.actions'),
                            width: 80,
                            render: (_, record) => (
                              <Button danger icon={<DeleteOutlined />} onClick={() => removeTableColumn(blockIndex, String((record as PrintTemplateTableColumnItem).key ?? ''))} />
                            ),
                          },
                        ]}
                      />
                    </>
                  ) : null}

                  {blockType === 'image' ? (
                    <>
                      <Row gutter={12} style={{ marginBottom: 12 }}>
                        <Col xs={24} md={16}>
                          <Form.Item label={t('printTemplate.imageAlt')} name={['schema', 'blocks', blockIndex, 'alt']} style={{ marginBottom: 0 }}>
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Button icon={<UploadOutlined />} onClick={() => selectImageFile(blockIndex)} style={{ width: '100%' }}>
                            {t('printTemplate.imageSelectFile')}
                          </Button>
                        </Col>
                      </Row>
                      <Form.Item label={t('printTemplate.imageSource')} name={['schema', 'blocks', blockIndex, 'src']} style={{ marginBottom: 0 }}>
                        <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
                      </Form.Item>
                    </>
                  ) : null}
            </Card>
          );}) : null}
        </Space>
      </Form.Item>
    </Form>
  );
}
