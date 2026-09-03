/* eslint-disable @typescript-eslint/no-unused-expressions */
import {assert, expect} from 'chai';
import {flexUrl} from '../src/index.js';

const baseUrl = 'http://api.mywebsite.com';

describe('URL Parsing', () => {
  it('Passing URL without query should not get any', () => {
    expect(flexUrl(baseUrl).params).to.be.empty;
  });

  it('Passing URL with query should get all as a params array', () => {
    const url = flexUrl(`${baseUrl}?filter[hello]=world&foo=bar`);

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(2);
  });

  it('Passing URL with query should serialise with URL encoding', () => {
    const url = flexUrl(`${baseUrl}?filter[hello]=test,world&filter[user.name][equal same]=Rubén Robles&foo=bar`);

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[hello]=test%2Cworld&filter[user.name][equal%20same]=Rub%C3%A9n%20Robles&foo=bar`);
  });

  it('Passing serialised URL from flexURL to flexURL for parsing should serialise as same (🤯)', () => {
    const url = flexUrl(`${baseUrl}?filter[hello]=world&foo=bar`);
    const sameUrl = flexUrl(url.toString());

    expect(url.toString()).to.be.eq(sameUrl.toString());
  });

  it('Passing URL native browser object will parse', () => {
    const nativeUrl = new URL(baseUrl);
    const url = flexUrl(nativeUrl);

    url.queryParam('test').add('hello');

    expect(url.toString()).to.be.eq(`${baseUrl}?test=hello`);
  });

  it('Passing URL with hash fragment respects order when parsing and serialising', () => {
    const nonHashedUrl = `${baseUrl}?filter[hello]=world`;
    const hashFragment = '#test';
    const url = flexUrl(`${nonHashedUrl}${hashFragment}`);

    url.queryParam('test').add('hello');

    expect(url.toString()).to.be.eq(`${nonHashedUrl}&test=hello${hashFragment}`);
  });
});

describe('URL Parsing with malformed percent-escapes', () => {
  it('A trailing percent sign does not throw', () => {
    const url = flexUrl(`${baseUrl}?discount=20%`);

    expect(url.queryParams.get('discount')).to.be.deep.eq({key: 'discount', value: ['20%']});
  });

  it('A percent sign inside a word does not throw', () => {
    const url = flexUrl(`${baseUrl}?q=50%off`);

    expect(url.queryParams.get('q')).to.be.deep.eq({key: 'q', value: ['50%off']});
  });

  it('A malformed escape inside a filter does not throw', () => {
    expect(() => flexUrl(`${baseUrl}?filter[status]=20%`)).to.not.throw();
  });

  it('A byte that is not valid UTF-8 does not throw', () => {
    expect(() => flexUrl(`${baseUrl}?name=%FF`)).to.not.throw();
  });

  it('One malformed parameter does not stop the others from parsing', () => {
    const url = flexUrl(`${baseUrl}?foo=bar&discount=20%&baz=qux`);

    expect(url.params).to.be.lengthOf(3);
    expect(url.queryParams.get('foo')).to.be.deep.eq({key: 'foo', value: ['bar']});
    expect(url.queryParams.get('baz')).to.be.deep.eq({key: 'baz', value: ['qux']});
  });

  it('A re-serialised malformed value escapes the percent and then round-trips', () => {
    const url = flexUrl(`${baseUrl}?discount=20%`);

    expect(url.toString()).to.be.eq(`${baseUrl}?discount=20%25`);
    expect(flexUrl(url.toString()).queryParams.get('discount')).to.be.deep.eq({key: 'discount', value: ['20%']});
  });

  it('Valid escapes still decode exactly as before', () => {
    const url = flexUrl(`${baseUrl}?name=Rub%C3%A9n%20Robles`);

    expect(url.queryParams.get('name')).to.be.deep.eq({key: 'name', value: ['Rubén Robles']});
  });
});

describe('Query Parameters Manipulation', () => {
  it('Set query parameter with empty params returns empty query', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').set('bar');
    url.queryParam('foo').set('hello');

    expect(url.params).to.be.empty;
    expect(url.toString()).to.be.eq(`${baseUrl}`);
  });

  it('Set query parameter replaces param with new value if one is present', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').set('hello');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=hello`);
  });

  it('Add query parameter with same key adds new parameter to ones already present', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('hello');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(2);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=bar&foo=hello`);
  });

  it('Add query parameter with same key and value does not add a new one', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('bar');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=bar`);
  });

  it('Add query parameter with modifiers adds new parameter with all modifiers added', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('filter').add('bar', ['foo']);
    url.queryParam('filter').add('hello', ['foo', 'test']);

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(2);
    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=bar&filter[foo][test]=hello`);
  });

  it('Add query parameter then change its modifiers adds modifiers to the added parameter', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('filter').add('bar').withModifiers(['foo', 'test']);

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo][test]=bar`);
  });

  it('Toggle query parameter adds new parameter if one not present', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').toggle('bar');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=bar`);
  });

  it('Toggle query parameter removes parameter if one present', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('hello');
    url.queryParam('foo').toggle('bar');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=hello`);
  });

  it('Replace query parameter value to a new passing function replaces it to the URL', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('hello');

    url.queryParam('foo').replace(value => `${value} world`);

    expect(url.toString()).to.be.eq(`${baseUrl}?foo=hello%20world`);
  });

  it('Replace query parameter value to a new passing string replaces it to the URL', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('hello');

    url.queryParam('foo').replace('world');

    expect(url.toString()).to.be.eq(`${baseUrl}?foo=world`);
  });

  it('Append query parameter adds value to already present parameter', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar').append(',test');
    url.queryParam('foo').add('hello').append(' world');

    expect(url.params).to.not.be.empty;
    expect(url.params).to.be.lengthOf(2);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=bar%2Ctest&foo=hello%20world`);
  });

  it('Append query parameter throws error when no previous parameter present', () => {
    const url = flexUrl(baseUrl);

    assert.throws(
      () => url.queryParam('foo').append(',hello'),
      'Query parameter must be provided to replace to the right parameter.',
    );

    expect(url.params).to.be.empty;
  });

  it('Remove query parameter by key', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('test');
    url.queryParam('foo').remove();

    // Expect(url.params).to.be.empty;
    expect(url.toString()).to.be.eq(baseUrl);
  });

  it('Remove query parameter by key and value', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('test');
    url.queryParam('foo').remove('bar');

    expect(url.params).to.be.lengthOf(1);
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=test`);
  });

  it('Clear removes all parameters from URL', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');
    url.queryParam('foo').add('hello,world');

    expect(url.params).to.not.be.empty;
    expect(url.toString()).to.be.eq(`${baseUrl}?foo=bar&foo=hello%2Cworld`);

    url.clear();

    expect(url.params).to.be.empty;
    expect(url.toString()).to.be.eq(baseUrl);
  });
});

describe('Query Parameters Checking', () => {
  it('Has checks query parameter with key and value is present on the URL', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('bar');

    expect(url.queryParams.has('foo')).to.be.true;
    expect(url.queryParams.has('foo', 'bar')).to.be.true;
    expect(url.queryParams.has('foo', 'hello')).to.be.false;
  });

  it('Has checks query parameter with key and value is not present on the URL', () => {
    const url = flexUrl(baseUrl);

    expect(url.queryParams.has('foo', 'hello')).to.be.false;
  });

  it('Get query parameter as object with key', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('var');

    expect(url.queryParams.get('foo')).to.be.deep.eq({key: 'foo', value: ['var']});
  });

  it('Get query parameter as object with key and modifiers getting undefined when none found', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('filter').add('var', ['foo']);

    expect(url.queryParams.get('filter')).to.be.undefined;
  });

  it('Get all query parameters as list (array) of objects', () => {
    const url = flexUrl(baseUrl);

    url.queryParam('foo').add('var');
    url.queryParam('filter').add('world', ['hello']);

    expect(url.queryParams.all()).to.be.deep.eq({
      foo: ['var'],
      'filter[hello]': ['world'],
    });
  });
});

describe('Query Filter Parameters Manipulation', () => {
  it('Add filter to URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=bar`);
  });

  it('Add AND filters to URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar').add('hello');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=bar&filter[foo]=hello`);
  });

  it('Add OR filters to URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar').or.add('hello');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=bar%2Chello`);
  });

  it('Add OR filters then add another as AND values in URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar').or.add('hello').and.add('test');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=bar%2Chello&filter[foo]=test`);
  });

  it('Add filter then toggle OR values in URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('hello').or.toggle('test');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=hello%2Ctest`);

    url.filter('foo').or.toggle('test');

    expect(url.toString()).to.be.eq(`${baseUrl}?filter[foo]=hello`);
  });
});

describe('Query Filter Parameters Checking', () => {
  it('Has filter checks query filter parameter with filter key and value is present on the URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar');

    expect(url.filters.has('foo')).to.be.true;
    expect(url.filters.has('foo', 'bar')).to.be.true;
    expect(url.filters.has('foo', 'hello')).to.be.false;
  });

  it('Has filter checks query filter parameter with filter key and OR values are present on the URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar,hello,world');

    expect(url.filters.has('foo')).to.be.true;
    expect(url.filters.has('foo', ['bar', 'world', 'hello'])).to.be.true;
  });

  it('Includes filter checks query filter parameter with filter key and some OR values are present on the URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar,hello,world');

    expect(url.filters.includes('foo', ['bar', 'world'])).to.be.true;
  });

  it('Includes filter checks query filter parameter with filter key and some OR values are not present on an AND filter based URL', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar').add('world');

    expect(url.filters.includes('foo', ['bar', 'world'])).to.be.false;
    expect(url.filters.includes('foo', ['bar'])).to.be.false;
    expect(url.filters.includes('foo', 'bar')).to.be.true;
  });

  it('Get filter parameter as object with key', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar');

    expect(url.filters.get('foo')).to.be.deep.eq({modifiers: [], value: ['bar']});
  });

  it('Get filter parameter as object with key and modifiers', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar');
    url.filter('foo').add('hello', ['equal']);

    expect(url.filters.get('foo', ['equal'])).to.be.deep.eq({modifiers: ['equal'], value: ['hello']});
  });

  it('Get all filter parameters as object', () => {
    const url = flexUrl(baseUrl);

    url.filter('foo').add('bar');
    url.filter('foo').add('hello', ['equal']);

    expect(url.filters.all()).to.be.deep.eq({
      foo: [
        {modifiers: [], value: ['bar']},
        {modifiers: ['equal'], value: ['hello']},
      ],
    });
  });
});

describe('Query Sort Parameter Manipulation', () => {
  it('Sort by asc', () => {
    const url = flexUrl(baseUrl);

    url.sort().toggle('foo');

    expect(url.toString()).to.be.eq(`${baseUrl}?sort=foo`);
  });

  it('Sort by desc', () => {
    const url = flexUrl(baseUrl);

    url.sort().toggle('foo').desc.toggle('bar');

    expect(url.toString()).to.be.eq(`${baseUrl}?sort=foo%2C-bar`);
  });

  it('Sort by desc (taking preference of second argument)', () => {
    const url = flexUrl(baseUrl);

    url.sort().toggle('foo').desc.toggle('bar', 'asc');

    expect(url.toString()).to.be.eq(`${baseUrl}?sort=foo%2Cbar`);
  });
});

describe('Query Sort Parameter Checking', () => {
  it('Get all sort parameter values as object', () => {
    const url = flexUrl(baseUrl);

    url.sort().toggle('foo').desc.toggle('bar');

    expect(url.sorts.all()).to.be.deep.eq({
      foo: 'asc',
      bar: 'desc',
    });
  });
});
