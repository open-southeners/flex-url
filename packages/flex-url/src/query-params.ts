import {type FlexibleUrl} from './flex-url.js';
import {decodeURIComponentSafe, getAllIndexes, setValueFromIndexes} from './util.js';

export type QueryParameterModifiers = string[];

export type QueryParameterObjectValue = string[];
export type QueryParametersObject = Record<string, QueryParameterObjectValue>;
export type QueryParameterObject = {
  key: string;
  value: QueryParameterObjectValue;
};

export class QueryParameter {
  constructor(public name: string, public value: string, public modifiers: QueryParameterModifiers = []) {}

  static queryParamKey(name: string, modifiers: QueryParameterModifiers = []): string {
    return `${name}${modifiers.map(modifier => `[${modifier}]`).join('')}`;
  }

  setValue(newValue: string): this {
    this.value = newValue;

    return this;
  }

  setModifiers(newModifiers: QueryParameterModifiers): this {
    this.modifiers = newModifiers;

    return this;
  }

  get queryParamKey(): string {
    return QueryParameter.queryParamKey(this.name, this.modifiers);
  }

  toString(): string {
    return `${QueryParameter.queryParamKey(encodeURIComponent(this.name), this.modifiers.map(modifier => encodeURIComponent(modifier)))}=${encodeURIComponent(this.value)}`;
  }

  static fromString(fragment: string): undefined | QueryParameter {
    const [queryParameterKey, value] = decodeURIComponentSafe(fragment).split('=');

    let key = queryParameterKey;
    let modifiers: QueryParameterModifiers = [];

    if (queryParameterKey.includes('[')) {
      const queryParameterKeyFragments = queryParameterKey.split(/\[|\|/);

      key = queryParameterKeyFragments.shift()!;

      modifiers = queryParameterKeyFragments.map(subFragment => subFragment.replace(']', ''));
    }

    if (!key) {
      return undefined;
    }

    return new QueryParameter(key, value, modifiers);
  }
}

export class QueryParameterChecker {
  constructor(private readonly flexUrl: FlexibleUrl) {
    this.flexUrl = flexUrl;
  }

  static find(flexUrl: FlexibleUrl, key: string, value?: string, modifiers?: QueryParameterModifiers, strict = true): number {
    return flexUrl.params.findIndex(queryParameter => {
      if (queryParameter.queryParamKey !== QueryParameter.queryParamKey(key, modifiers)) {
        return false;
      }

      if (strict) {
        return value ? queryParameter.value.toLocaleLowerCase() === value.toLocaleLowerCase() : true;
      }

      return value ? queryParameter.value.includes(value) : true;
    });
  }

  includes(key: string, value?: string, modifiers?: QueryParameterModifiers): boolean {
    return this.has(key, value, modifiers, false);
  }

  has(key: string, value?: string, modifiers?: QueryParameterModifiers, strict = true): boolean {
    return QueryParameterChecker.find(this.flexUrl, key, value, modifiers, strict) !== -1;
  }

  all(): QueryParametersObject {
    const queryParametersObject: QueryParametersObject = {};

    for (let i = 0; i < this.flexUrl.params.length; i++) {
      const parameter = this.flexUrl.params[i];

      queryParametersObject[parameter.queryParamKey] = parameter.value.split(',');
    }

    return queryParametersObject;
  }

  get(key: string, modifiers?: QueryParameterModifiers): QueryParameterObject | undefined {
    const foundIndex = QueryParameterChecker.find(this.flexUrl, key, undefined, modifiers);

    if (foundIndex === -1) {
      return undefined;
    }

    const foundParameter = this.flexUrl.params[foundIndex];

    return {
      key: foundParameter.queryParamKey,
      value: foundParameter.value.split(','),
    };
  }
}

export class QueryParameterManipulator {
  constructor(private flexUrl: FlexibleUrl, private readonly name: string, private readonly value?: string, private readonly modifiers: QueryParameterModifiers = [], private readonly indexes: number[] = []) {
    if (indexes.length === 0) {
      this.indexes = getAllIndexes(flexUrl.params, parameter =>
        parameter.queryParamKey === QueryParameter.queryParamKey(name, modifiers)
          && (value ? parameter.value === value : true),
      );
    }
  }

  /**
   * Create instance of QueryParamaterManipulator from known parameters indexes.
   */
  static fromIndexes(flexUrl: FlexibleUrl, name: string, indexes: number[], modifiers: QueryParameterModifiers = []): QueryParameterManipulator {
    return new QueryParameterManipulator(flexUrl, name, undefined, modifiers, indexes);
  }

  /**
   * Get underlying Flex URL instance.
   */
  get url(): FlexibleUrl {
    return this.flexUrl;
  }

  /**
   * Get if manipulator contains existing parameters.
   */
  get exists(): boolean {
    return this.indexes.length > 0
      && this.indexes.every((v, i) => Boolean(this.flexUrl.params?.[i]));
  }

  /**
   * Add query parameter with value and/or modifiers.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#set
   */
  set(value: string, modifiers: QueryParameterModifiers = []): this {
    setValueFromIndexes(this.flexUrl.params, this.indexes, new QueryParameter(this.name, value, modifiers));

    return this;
  }

  /**
   * Add query parameter with value and/or modifiers.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#add
   */
  add(value: string, modifiers: QueryParameterModifiers = []): QueryParameterManipulator {
    const existing = QueryParameterChecker.find(this.flexUrl, this.name, value, modifiers);

    if (existing !== -1) {
      return QueryParameterManipulator.fromIndexes(this.flexUrl, this.name, [existing]);
    }

    this.flexUrl.params.push(new QueryParameter(this.name, value, modifiers));

    return new QueryParameterManipulator(this.flexUrl, this.name, value, modifiers);
  }

  /**
   * Replace value to query parameter.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#replace
   */
  replace(replacement: string | ((oldValue: string) => string)): this {
    if (!this.indexes?.length) {
      throw new Error('Query parameter must be provided to replace to the right parameter.');
    }

    setValueFromIndexes(this.flexUrl.params, this.indexes, old =>
      old.setValue(typeof replacement === 'function' ? replacement(old.value) : replacement),
    );

    return this;
  }

  /**
   * Append value to query parameter.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#append
   */
  append(appendValue: string): this {
    return this.replace(oldValue => `${oldValue}${appendValue}`);
  }

  /**
   * Conditionally add or remove query parameter with value and/or modifiers.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#toggle
   */
  toggle(value: string, modifiers: QueryParameterModifiers = []): QueryParameterManipulator {
    const existing = QueryParameterChecker.find(this.flexUrl, this.name, value, modifiers);

    if (existing !== -1) {
      this.remove(value, modifiers, existing);

      return this;
    }

    return this.add(value, modifiers);
  }

  /**
   * Remove query parameter with value and/or modifiers.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#remove
   */
  remove(value?: string, modifiers: QueryParameterModifiers = [], index?: number): FlexibleUrl {
    this.flexUrl.params = this.flexUrl.params.filter((parameter, i) => {
      if (index) {
        return index === i;
      }

      if (parameter.queryParamKey !== QueryParameter.queryParamKey(this.name, modifiers)) {
        return true;
      }

      if (value) {
        return !parameter.value.includes(value);
      }

      return false;
    });

    return this.flexUrl;
  }

  /**
   * Set query parameter modifiers.
   *
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#withModifiers
   */
  withModifiers(modifiers: QueryParameterModifiers): this {
    setValueFromIndexes(this.flexUrl.params, this.indexes, parameter => parameter.setModifiers(modifiers));

    return this;
  }
}
