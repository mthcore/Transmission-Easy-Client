/**
 * Stylesheets imported for their side effect.
 *
 * Webpack turns these into an injected <style> tag; nothing reads a value from
 * them, which is why they are imported bare. TypeScript 6 stopped assuming a
 * module exists behind such an import (TS2882) and asks for the declaration
 * outright, so here it is — one module shape per extension the build handles.
 */
declare module '*.css';
declare module '*.scss';
