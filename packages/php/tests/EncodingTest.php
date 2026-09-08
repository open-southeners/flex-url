<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl\Tests;

use OpenSoutheners\FlexUrl\FlexUrlOptions;
use OpenSoutheners\FlexUrl\Internal\Encoding;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers `Encoding::encodeList()`/`decodeList()`'s opt-in `strictCommaEncoding`
 * behaviour in isolation, plus a regression guard proving the default
 * (lenient) path is unchanged by the new parameter.
 *
 * @SuppressWarnings("PHPMD.StaticAccess")
 */
class EncodingTest extends TestCase
{
    // -----------------------------------------------------------------
    // strictCommaEncoding: decodeList()
    // -----------------------------------------------------------------

    public function test_strict_decode_list_of_empty_string_yields_empty_list(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame([], Encoding::decodeList('', $options));
    }

    public function test_strict_decode_list_with_no_comma_yields_single_value(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame(['foobar'], Encoding::decodeList('foobar', $options));
    }

    public function test_strict_decode_list_splits_on_a_raw_comma(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame(['published', 'draft'], Encoding::decodeList('published,draft', $options));
    }

    public function test_strict_decode_list_keeps_a_percent_encoded_comma_as_literal_content(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame(['foo,bar'], Encoding::decodeList('foo%2Cbar', $options));
    }

    public function test_strict_decode_list_mixes_a_literal_comma_within_a_value_and_a_real_separator(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame(['foo,bar', 'baz'], Encoding::decodeList('foo%2Cbar,baz', $options));
    }

    // -----------------------------------------------------------------
    // strictCommaEncoding: encodeList()
    // -----------------------------------------------------------------

    public function test_strict_encode_list_of_empty_array_yields_empty_string(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame('', Encoding::encodeList([], $options));
    }

    public function test_strict_encode_list_with_no_comma_leaves_value_untouched(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame('foobar', Encoding::encodeList(['foobar'], $options));
    }

    public function test_strict_encode_list_keeps_a_literal_comma_inside_one_value_percent_encoded(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame('foo%2Cbar', Encoding::encodeList(['foo,bar'], $options));
    }

    public function test_strict_encode_list_joins_multiple_values_with_a_raw_comma_separator(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $this->assertSame('published,draft', Encoding::encodeList(['published', 'draft'], $options));
    }

    public function test_strict_encode_list_round_trips_a_mixed_literal_and_separator_comma(): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: true);

        $encoded = Encoding::encodeList(['foo,bar', 'baz'], $options);

        $this->assertSame('foo%2Cbar,baz', $encoded);
        $this->assertSame(['foo,bar', 'baz'], Encoding::decodeList($encoded, $options));
    }

    // -----------------------------------------------------------------
    // Regression guard: the default (lenient) behaviour is unchanged
    // -----------------------------------------------------------------

    #[DataProvider('lenientDecodeValues')]
    public function test_default_options_decode_list_is_byte_identical_to_the_pre_existing_single_argument_call(string $raw): void
    {
        $this->assertSame(Encoding::decodeList($raw), Encoding::decodeList($raw, new FlexUrlOptions));
    }

    #[DataProvider('lenientEncodeValues')]
    public function test_default_options_encode_list_is_byte_identical_to_the_pre_existing_single_argument_call(array $values): void
    {
        $this->assertSame(Encoding::encodeList($values), Encoding::encodeList($values, new FlexUrlOptions));
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function lenientDecodeValues(): array
    {
        $values = ['', 'a,b', 'a%2Cb', 'a%2Cb,c', ',', ',,', 'a,,b', 'foobar'];

        $named = [];

        foreach ($values as $value) {
            $named[$value === '' ? '(empty)' : $value] = [$value];
        }

        return $named;
    }

    /**
     * @return array<string, array{0: list<string>}>
     */
    public static function lenientEncodeValues(): array
    {
        return [
            '(empty)' => [[]],
            'foobar' => [['foobar']],
            'a,b' => [['a,b']],
            'published,draft' => [['published', 'draft']],
            'a,b + c' => [['a,b', 'c']],
        ];
    }
}
