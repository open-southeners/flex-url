<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl\Tests;

use OpenSoutheners\FlexUrl\FlexUrl;
use OpenSoutheners\FlexUrl\FlexUrlOptions;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Replays `fixtures/cases.json` — the language-neutral contract shared with
 * the Vitest suite (see `fixtures/SCHEMA.md`). Every case's `build` steps
 * are applied in order to a fresh builder from `base`, the result is
 * compared against `url`, and (when present) every `reads` assertion is
 * checked against a fresh builder parsed straight back from that `url`.
 *
 * @SuppressWarnings("PHPMD.StaticAccess")
 */
class FixturesTest extends TestCase
{
    public function test_fixtures_file_is_not_empty(): void
    {
        $this->assertNotEmpty(self::cases());
    }

    /**
     * @param  array{name: string, base: string, build: list<array{op: string, args: list<mixed>}>, url: string, readsFrom?: string, reads?: list<array{op: string, args: list<mixed>, equals: mixed}>, options?: array{strictCommaEncoding?: bool}}  $testCase
     */
    #[DataProvider('cases')]
    public function test_case(array $testCase): void
    {
        $options = new FlexUrlOptions(strictCommaEncoding: $testCase['options']['strictCommaEncoding'] ?? false);

        $builder = FlexUrl::make($testCase['base'], $options);

        foreach ($testCase['build'] as $step) {
            $builder = $builder->{$step['op']}(...$step['args']);
        }

        $this->assertSame($testCase['url'], $builder->toString());

        // Re-parsing the canonical output must reproduce it byte for byte. Asserted
        // for every case rather than a chosen few: it is the invariant that breaks
        // first when encoding and parsing stop being exact inverses of each other.
        $this->assertSame($testCase['url'], FlexUrl::make($testCase['url'], $options)->toString());

        if (! isset($testCase['reads'])) {
            return;
        }

        // Parse-only cases read from the (possibly un-emittable) `base`; every
        // other case reads from `url` to assert that parse = build.
        $reader = FlexUrl::make(($testCase['readsFrom'] ?? 'url') === 'base' ? $testCase['base'] : $testCase['url'], $options);

        foreach ($testCase['reads'] as $read) {
            $this->assertEquals($read['equals'], $reader->{$read['op']}(...$read['args']), "read op \"{$read['op']}\" for fixture \"{$testCase['name']}\"");
        }
    }

    /**
     * @return array<string, array{0: array<string, mixed>}>
     */
    public static function cases(): array
    {
        $path = __DIR__.'/../../../fixtures/cases.json';

        /** @var list<array<string, mixed>> $cases */
        $cases = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        $named = [];

        foreach ($cases as $case) {
            /** @var string $name */
            $name = $case['name'];
            $named[$name] = [$case];
        }

        return $named;
    }
}
