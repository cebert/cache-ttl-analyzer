/**
 * Registers jest-dom's Vitest matcher types. `setup.ts` imports the runtime
 * side conditionally (the Node-environment engine tests must not load DOM
 * helpers), which is invisible to the type checker — this makes
 * `toBeInTheDocument` and friends known to it.
 */

import '@testing-library/jest-dom/vitest'
