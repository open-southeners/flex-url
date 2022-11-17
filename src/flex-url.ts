import {FilterParameterManipulator, FilterParameterChecker} from './filter-params.js'
import {QueryParameter, QueryParameterChecker, QueryParameterManipulator} from './query-params.js'

export class FlexibleUrl {
  private baseUrl: string
  params: Array<QueryParameter> = []

  constructor(url?: string | URL) {
    this.baseUrl = (typeof url === 'object' ? url.host : url) || (typeof window === 'undefined' ? '' : window.location.toString())

    const urlFragments = this.baseUrl.split('?')
    const paramsFromUrl = urlFragments.length === 2 ? urlFragments.pop() : null

    this.baseUrl = urlFragments.length === 0 ? this.baseUrl : urlFragments.join('')

    if (paramsFromUrl) {
      this.params = paramsFromUrl.split('&')
        .map((fragment) => QueryParameter.fromString(fragment))
        .filter((param) => param !== null) as Array<QueryParameter>
    }
  }

  /**
   * Manipulate URL query parameters
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams
   */
  queryParam(name: string, value?: string) {
    return new QueryParameterManipulator(this, name, value)
  }

  /**
   * Check URL query parameters
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#check
   */
  get queryParams() {
    return new QueryParameterChecker(this)
  }

  /**
   * Manipulate URL query filter parameters
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#filters
   */
  filter(filterKey: string) {
    return FilterParameterManipulator.fromUrl(this, filterKey)
  }

  /**
   * Check URL query filter parameters
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/queryParams#filters
   */
  get filters() {
    return new FilterParameterChecker(this)
  }

  /**
   * Clear all params from URL
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/flexUrl#clear
   */
  clear() {
    this.params = []

    return this
  }

  /**
   * Parse Flex URL back to string
   * 
   * @see Docs https://flex-url.opensoutheners.com/docs/toString
   */
  toString() {
    return [this.baseUrl, this.params.map((param) => param.toString()).join('&')]
      .filter(Boolean)
      .join('?')
  }
}