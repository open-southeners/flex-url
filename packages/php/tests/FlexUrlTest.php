<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl\Tests;

use OpenSoutheners\FlexUrl\FlexUrl;
use PHPUnit\Framework\TestCase;

use function flex_url;

class FlexUrlTest extends TestCase
{
    public function test_exposes_the_current_version(): void
    {
        $this->assertSame('2.0.0', FlexUrl::VERSION);
    }

    public function test_make_returns_a_bare_builder_when_no_url_given(): void
    {
        $this->assertSame('', FlexUrl::make()->toString());
    }

    public function test_flex_url_helper_is_an_alias_for_make(): void
    {
        $this->assertSame(
            FlexUrl::make('/posts')->filter('status', 'published')->toString(),
            flex_url('/posts')->filter('status', 'published')->toString(),
        );
    }

    public function test_from_accepts_a_stringable_value(): void
    {
        $uri = new class implements \Stringable
        {
            public function __toString(): string
            {
                return 'https://api.example.com/posts?foo=bar';
            }
        };

        $this->assertSame('https://api.example.com/posts?foo=bar', FlexUrl::from($uri)->toString());
    }

    // -----------------------------------------------------------------
    // Immutability
    // -----------------------------------------------------------------

    public function test_every_mutator_returns_a_new_instance_the_receiver_is_never_changed(): void
    {
        $base = FlexUrl::make('/posts');
        $withFilter = $base->filter('status', 'published');

        $this->assertNotSame($base, $withFilter);
        $this->assertSame('/posts', $base->toString());
        $this->assertSame('/posts?filter[status]=published', $withFilter->toString());
    }

    public function test_removing_a_filter_from_a_derived_instance_does_not_affect_the_original(): void
    {
        $original = FlexUrl::make('/posts')->filter('status', 'published');
        $withoutStatus = $original->removeFilter('status');

        $this->assertTrue($original->hasFilter('status'));
        $this->assertFalse($withoutStatus->hasFilter('status'));
    }

    // -----------------------------------------------------------------
    // __toString() / toString()
    // -----------------------------------------------------------------

    public function test_to_string_and_magic_to_string_agree(): void
    {
        $built = FlexUrl::make('/posts')->filter('status', 'published');

        $this->assertSame($built->toString(), (string) $built);
    }

    // -----------------------------------------------------------------
    // toQuery() / toRequestUri()
    // -----------------------------------------------------------------

    public function test_to_query_returns_a_native_php_array_shaped_like_request_query(): void
    {
        $built = FlexUrl::make('/posts')
            ->filter('status', ['published', 'draft'])
            ->filter('due_at', 'gte', '2024-01-01')
            ->sort('-created_at')
            ->page(2);

        $this->assertSame([
            'filter' => [
                'status' => 'published,draft',
                'due_at' => ['gte' => '2024-01-01'],
            ],
            'sort' => '-created_at',
            'page' => ['number' => '2'],
        ], $built->toQuery());
    }

    public function test_to_query_url_decodes_values(): void
    {
        $built = FlexUrl::make('/posts')->filter('title', 'a,b');

        $this->assertSame(['filter' => ['title' => 'a,b']], $built->toQuery());
    }

    public function test_to_request_uri_includes_pathname_and_query_but_never_scheme_host_or_hash(): void
    {
        $built = FlexUrl::make('https://api.example.com/api/v1/posts#comments')->filter('status', 'published');

        $this->assertSame('/api/v1/posts?filter[status]=published', $built->toRequestUri());
    }

    public function test_to_request_uri_with_no_query_is_just_the_pathname(): void
    {
        $this->assertSame('/posts', FlexUrl::make('/posts')->toRequestUri());
    }

    public function test_to_relative_url_drops_the_origin_but_keeps_the_hash(): void
    {
        $built = FlexUrl::make('https://api.example.com/api/v1/posts#comments')->filter('status', 'published');

        $this->assertSame('/api/v1/posts?filter[status]=published#comments', $built->toRelativeUrl());
        // The one difference from toRequestUri(): a fragment is client-side
        // navigation, so it survives here and is dropped there.
        $this->assertSame('/api/v1/posts?filter[status]=published', $built->toRequestUri());
    }

    public function test_to_relative_url_drops_a_non_default_port_along_with_the_origin(): void
    {
        $built = FlexUrl::make('http://localhost:8000/projects?page[number]=2')->filter('status', 'active');

        $this->assertSame('/projects?page[number]=2&filter[status]=active', $built->toRelativeUrl());
    }

    public function test_to_relative_url_with_no_query_is_just_the_pathname(): void
    {
        $this->assertSame('/posts', FlexUrl::make('/posts')->toRelativeUrl());
    }

    // -----------------------------------------------------------------
    // Operator alias normalisation
    // -----------------------------------------------------------------

    public function test_eq_alias_normalises_to_equal_on_the_wire_and_when_reading(): void
    {
        $built = FlexUrl::make('/posts')->filter('title', 'eq', 'Hello World');

        $this->assertSame('/posts?filter[title][equal]=Hello%20World', $built->toString());
        $this->assertSame('Hello World', $built->getFilter('title', 'eq'));
        $this->assertSame('Hello World', $built->getFilter('title', 'equal'));
        $this->assertTrue($built->hasFilter('title', 'eq'));
    }

    public function test_remove_filter_eq_alias_removes_the_equal_entry(): void
    {
        $built = FlexUrl::make('/posts')->filter('title', 'equal', 'Hello')->removeFilter('title', 'eq');

        $this->assertFalse($built->hasFilter('title', 'equal'));
    }

    // -----------------------------------------------------------------
    // Encoding edges
    // -----------------------------------------------------------------

    public function test_boolean_values_stringify_like_javascripts_string_coercion(): void
    {
        $built = FlexUrl::make('/posts')->filterScope('overdue', ['flag' => true, 'other' => false]);

        $this->assertSame('true', $built->getFilter('overdue', 'flag'));
        $this->assertSame('false', $built->getFilter('overdue', 'other'));
    }

    public function test_a_value_with_reserved_marks_round_trips_without_being_over_escaped(): void
    {
        $built = FlexUrl::make('/posts')->filter('title', "a!b'c(d)e*f");

        $reparsed = FlexUrl::make($built->toString());

        $this->assertSame("a!b'c(d)e*f", $reparsed->getFilter('title'));
    }

    public function test_parsing_accepts_percent_encoded_brackets_in_keys(): void
    {
        $built = FlexUrl::make('http://localhost:8000/api/films?page%5Bnumber%5D=2');

        $this->assertSame(2, $built->getPage());
    }
}
