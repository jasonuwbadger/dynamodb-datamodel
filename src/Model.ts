import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { Condition } from './Condition';
import { Fields } from './Fields';
import { Table } from './Table';
import { Update } from './Update';

/**
 *
 */
export class Model implements Model.ModelBase {
  name?: string;
  schema: Model.ModelSchema;
  table: Table;
  onError?: (msg: string) => void;

  constructor(params: Model.ModelParams) {
    this.name = params.name;
    this.schema = params.schema;
    // TODO: register model with table to support query and scan data mapping
    this.table = params.table;
    this.onError = params.table.onError;
    this.setSchema(params.schema);
  }

  setSchema(schema: Model.ModelSchema): void {
    this.schema = schema;
    Object.keys(schema).forEach((key) => schema[key].init(key, this));
  }

  toTable(data: Model.ModelData, context: Fields.TableContext): Model.TableData {
    const tableData: Table.AttributeValuesMap = {};
    // enumerate schema so each field gets called
    // ... handled by table to* if supported (do we need each field to return array of names processed)
    const keys = Object.keys(this.schema);
    for (const name of keys) {
      const schema: Fields.Field = this.schema[name];
      schema.toTable(name, data, tableData, context);
    }
    return this.splitTableData(tableData);
  }

  toTableKey(key: Model.ModelCore, context: Fields.TableContext): Table.PrimaryKey.AttributeValuesMap {
    return this.toTable(key, context).key;
  }

  toTableUpdate(data: Model.ModelUpdate, context: Fields.TableContext): Model.TableUpdateData {
    const tableData: Table.AttributeValuesMap = {};
    // enumerate schema so each field gets called
    // ... handled by table to* if supported (do we need each field to return array of names processed)
    const keys = Object.keys(this.schema);
    for (const name of keys) {
      const schema: Fields.Field = this.schema[name];
      if (schema.toTableUpdate === undefined) continue;
      schema.toTableUpdate(name, data, tableData, context);
    }
    return this.splitTableData(tableData);
  }

  toModel(data: Table.AttributeValuesMap | undefined, context: Fields.ModelContext): Model.ModelOut | undefined {
    data = data || {};
    const out: Model.ModelOut = {};
    const keys = Object.keys(this.schema);
    for (const name of keys) {
      const schema: Fields.Field = this.schema[name];
      schema.toModel(name, data, out, context);
    }
    if (Object.keys(out).length > 0) return out;
    return undefined;
  }

  getContext(action: Table.ItemActions, options: Table.BaseOptions): Fields.TableContext {
    // Note: options.conditions is set on the passed in options even if
    if (!options.conditions) options.conditions = [];
    return { action, conditions: options.conditions, options, model: this };
  }

  getParams(key: Model.ModelCore, options: Table.GetOptions = {}): DocumentClient.GetItemInput {
    const tableKey = this.toTableKey(key, this.getContext('get', options));
    return this.table.getParams(tableKey, options);
  }
  putParams(item: Model.ModelCore, options: Table.PutOptions = {}): DocumentClient.PutItemInput {
    const action = Table.getPutAction(options.writeOptions);
    const tableData = this.toTable(item, this.getContext(action, options));
    return this.table.putParams(tableData.key, tableData.item, options);
  }
  deleteParams(key: Model.ModelCore, options: Table.DeleteOptions = {}): DocumentClient.DeleteItemInput {
    const tableKey = this.toTableKey(key, this.getContext('delete', options));
    return this.table.deleteParams(tableKey, options);
  }
  updateParams(item: Model.ModelUpdate, options: Table.UpdateOptions = {}): DocumentClient.UpdateItemInput {
    const tableData = this.toTableUpdate(item, this.getContext('update', options));
    return this.table.updateParams(tableData.key, tableData.item, options);
  }

  async get(key: Model.ModelCore, options: Table.GetOptions = {}): Promise<Model.PutOutput> {
    const context = this.getContext('get', options);
    const tableKey = this.toTableKey(key, context);
    const result = await this.table.get(tableKey, options);
    const item = this.toModel(result.Item, context);
    return { item, result };
  }
  create(data: Model.ModelCore, options: Table.PutOptions = {}): Promise<Model.PutOutput> {
    options.writeOptions = 'NotExists';
    return this.put(data, options);
  }
  replace(data: Model.ModelCore, options: Table.PutOptions = {}): Promise<Model.PutOutput> {
    options.writeOptions = 'Exists';
    return this.put(data, options);
  }
  async put(data: Model.ModelCore, options: Table.PutOptions = {}): Promise<Model.PutOutput> {
    const action = Table.getPutAction(options.writeOptions);
    const context = this.getContext(action, options);
    const tableData = this.toTable(data, context);
    const result = await this.table.put(tableData.key, tableData.item, options);
    const item = this.toModel({ ...tableData.key, ...tableData.item }, context);
    return { item, result };
  }
  async delete(key: Model.ModelCore, options: Table.DeleteOptions = {}): Promise<Model.DeleteOutput> {
    const context = this.getContext('delete', options);
    const tableKey = this.toTableKey(key, context);
    const result = await this.table.delete(tableKey, options);
    const item = this.toModel(result.Attributes, context);
    return { item, result };
  }
  async update(data: Model.ModelUpdate, options: Table.UpdateOptions = {}): Promise<Model.UpdateOutput> {
    const context = this.getContext('update', options);
    const tableData = this.toTableUpdate(data, context);
    const result = await this.table.update(tableData.key, tableData.item, options);
    const item = this.toModel(result.Attributes, context);
    return { item, result };
  }

  private splitTableData(
    data: Table.AttributeValuesMap,
  ): {
    key: Table.PrimaryKey.AttributeValuesMap;
    item: Table.AttributeValuesMap;
  } {
    const key: Table.PrimaryKey.AttributeValuesMap = {};
    const item: Table.AttributeValuesMap = { ...data };
    Object.keys(this.table.keySchema).forEach((name) => {
      const value = data[name];
      if (value === undefined || value === null) return;
      key[name] = value;
      delete item[name];
    });
    return { key, item };
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace, no-redeclare
export namespace Model /* istanbul ignore next: needed for ts with es5 */ {
  export interface ModelBase {
    name?: string;
    schema: Model.ModelSchema;
    table: Table;
    onError?: (msg: string) => void;
  }

  export type ModelType = number | string | boolean | null | object;
  export type ModelData = { [key: string]: ModelType };

  export type TableData = {
    key: Table.PrimaryKey.AttributeValuesMap;
    item?: Table.AttributeValuesMap;
    conditions?: Condition.Resolver[];
  };

  export type TableUpdateData = {
    key: Table.PrimaryKey.AttributeValuesMap;
    item?: Update.UpdateMapValue;
    conditions?: Condition.Resolver[];
  };

  export interface ModelParams {
    name?: string;
    schema: ModelSchema;
    table: Table;
  }

  export type ModelUpdateValue<T> = Extract<T, ModelType> | null | Update.Resolver<string>;

  // *Map used as model data based params in Model
  export type ModelSchema = { [key: string]: Fields.Field };
  export type ModelCore = { [key: string]: ModelType };
  export type ModelOut = { [key: string]: ModelType };
  export type ModelUpdate = {
    [key: string]: ModelUpdateValue<ModelType>;
  };

  // Could add hidden property that contains properties not exposed in model schema,
  // like type, create date, modify date, delete attribute.  Though in most cases I
  // think they should be exposed to the model in some manor.  Though type may
  // be the one property that isn't exposed, though then how do we differentiate
  // a heterogeneous item query?
  export interface GetOutput<T = ModelOut> {
    item?: T;
    result: DocumentClient.GetItemOutput;
  }

  export interface PutOutput<T = ModelOut> {
    item?: T;
    result: DocumentClient.PutItemOutput;
  }

  export interface DeleteOutput<T = ModelOut> {
    item?: T;
    result: DocumentClient.DeleteItemOutput;
  }

  export interface UpdateOutput<T = ModelOut> {
    item?: T;
    result: DocumentClient.UpdateItemOutput;
  }

  // ModelT
  // *MapT used as model data based params in ModelT
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ModelSchemaT<T extends { [key: string]: any }> = {
    [P in keyof Required<T>]: Fields.Field;
  };
  export type ModelCoreT<T> = {
    [P in keyof T]: Extract<T[P], ModelType>;
  };
  export type ModelOutT<T> = {
    [P in keyof T]: Extract<T[P], ModelType>;
  };
  export type ModelUpdateT<T> = {
    [P in keyof Table.Optional<T>]: ModelUpdateValue<T[P]>;
  };

  export interface ModelParamsT<KEY, MODEL extends KEY = KEY> extends ModelParams {
    schema: ModelSchemaT<MODEL>;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface ModelT<KEY extends { [key: string]: any }, MODEL extends KEY = KEY> extends Model {
    schema: Model.ModelSchemaT<MODEL>;

    setSchema(schema: Model.ModelSchemaT<MODEL>): void;
    toTable(data: Model.ModelCoreT<MODEL>): Model.TableData;
    toTableKey(data: Model.ModelCoreT<KEY>): Table.PrimaryKey.AttributeValuesMap;
    toTableUpdate(data: Model.ModelUpdateT<MODEL>): Model.TableUpdateData;
    toModel(data: Table.AttributeValuesMap): Model.ModelOutT<MODEL>;

    getParams(key: Model.ModelCoreT<KEY>, options?: Table.GetOptions): DocumentClient.GetItemInput;
    putParams(data: Model.ModelCoreT<MODEL>, options?: Table.PutOptions): DocumentClient.PutItemInput;
    deleteParams(key: Model.ModelCoreT<KEY>, options?: Table.DeleteOptions): DocumentClient.DeleteItemInput;
    updateParams(data: Model.ModelUpdateT<MODEL>, options?: Table.UpdateOptions): DocumentClient.UpdateItemInput;

    get(key: Model.ModelCoreT<KEY>, options?: Table.GetOptions): Promise<Model.GetOutput<MODEL>>;
    create(data: Model.ModelCoreT<MODEL>, options?: Table.PutOptions): Promise<Model.PutOutput<MODEL>>;
    replace(data: Model.ModelCoreT<MODEL>, options?: Table.PutOptions): Promise<Model.PutOutput<MODEL>>;
    put(data: Model.ModelCoreT<MODEL>, options?: Table.PutOptions): Promise<Model.PutOutput<MODEL>>;
    delete(key: Model.ModelCoreT<KEY>, options?: Table.DeleteOptions): Promise<Model.DeleteOutput<MODEL>>;
    update(data: Model.ModelUpdateT<MODEL>, options?: Table.UpdateOptions): Promise<Model.UpdateOutput<MODEL>>;
  }

  /**
   *
   * See {@link Table.createTable} reasoning for having a createTable over support 'new TableT'.
   * @param params
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-inner-declarations
  export function createModel<KEY extends { [key: string]: any }, MODEL extends KEY = KEY>(
    params: ModelParamsT<KEY, MODEL>,
  ): Model.ModelT<KEY, MODEL> {
    return new Model(params) as Model.ModelT<KEY, MODEL>;
  }
}
