/*
 * Force-in macros for this recipe's OpenSSL build.
 *
 * Shipped alongside the APKBUILD and listed in its source= with its own
 * checksum, the way aports ships a patch: it is configuration this
 * platform needs, not a local source change. The recipe passes it to
 * Configure as `CFLAGS=-include .../wasm-fixups.h`, so it lands ahead
 * of every OpenSSL translation unit and can win against tests that run
 * before any OpenSSL header is read.
 *
 * One macro per source-file quirk, each with the file it is for and the
 * reason. Anything that belongs in Configure's own feature list (a
 * no-<feature> flag) goes there instead — this file is only for the
 * cases a flag cannot express.
 */

/*
 * crypto/o_str.c:openssl_strerror_r
 *   OpenSSL selects the GNU-extension strerror_r variant (char* return)
 *   when _GNU_SOURCE is defined. Musl always provides the POSIX variant
 *   (int return) — _GNU_SOURCE affects extensions, not strerror_r's
 *   signature. Force OpenSSL to the POSIX branch by undefining
 *   _GNU_SOURCE before the #ifdef test runs.
 */
#ifdef _GNU_SOURCE
#undef _GNU_SOURCE
#endif

/*
 * crypto/bn/bn_local.h:BN_UMULT_HIGH — deliberately left undefined.
 *   The `__uint128_t` branch is pure C and `no-asm` hides it, which looks
 *   like a bug worth patching around. It is not: wasm64 has no widening
 *   multiply, so LLVM lowers a 128-bit product to a __multi3 libcall —
 *   a call per limb. Measured on bn_mul_add_words: stock 3961 instrs,
 *   hand-rolled 32x32 LOHI 4180, __uint128_t a libcall. OpenSSL's
 *   SIXTY_FOUR_BIT_LONG fallback already is the right lowering here.
 */
