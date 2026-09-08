<?php

declare(strict_types=1);

namespace OpenSoutheners\FlexUrl;

/**
 * Construction options for `FlexUrl::make()`/`FlexUrl::from()`. Mirrors the
 * TypeScript package's `FlexUrlOptions` interface — kept identical on
 * purpose, see `packages/js/src/encoding.ts`.
 */
final readonly class FlexUrlOptions
{
    public function __construct(public bool $strictCommaEncoding = false) {}
}
