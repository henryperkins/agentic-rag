#!/usr/bin/env python3
"""
OpenAPI YAML de-referencer & flattener (self-contained, no CLI needed)

- Recursively replaces all $ref nodes with resolved content so the doc reads as a tree.
- Annotates inlined objects with `x-resolved-from` for traceability.
- Handles circular refs with a compact placeholder to avoid infinite recursion.
- Optionally coerces `openapi:` version at the document root (e.g., 3.1.0 -> 3.0.0).
- Preserves human-readable formatting:
    * Multiline strings are emitted as YAML block scalars (`|`) so JSON examples
      and long descriptions remain readable.
    * Indents sequences under mapping keys (no "indentless" lists).
- Final pass to prune unused entries inside `components/*` after dereferencing.
  Any component not referenced by a remaining `$ref`, by `discriminator.mapping`,
  or by `security` requirements is removed. Vendor extension keys (`x-*`) are preserved.

Adjust the globals below for input/output paths and behavior; there is no CLI.
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse, urljoin, unquote

import yaml


# ──────────────────────────────────────────────────────────────────────────────
# Globals – adjust these to your environment (no command line use)
# ──────────────────────────────────────────────────────────────────────────────
INPUT_FILE: str = "openai.yml"          # path to input YAML
OUTPUT_FILE: str = "openai-openapi.deref.yml"   # path for flattened output

# If the file says "openapi: 3.1.0" but it isn't compliant, set this to "3.0.0".
# Set to None to keep the original value.
OPENAPI_VERSION_OVERRIDE: str | None = "3.0.0"

# If the spec uses external $ref (file/URL), toggle these:
HANDLE_EXTERNAL_REFS: bool = True   # allow resolving refs to other files/URLs
ALLOW_HTTP_FETCH: bool = False      # set True to allow fetching http(s) refs

# Output formatting
YAML_LINE_WIDTH: int = 100
YAML_INDENT: int = 2

# Tuning
ADD_X_RESOLVED_FROM: bool = True            # annotate inlined objects
CIRCULAR_REF_PLACEHOLDER: bool = True       # break cycles with a placeholder
MERGE_REQUIRED_LISTS: bool = True           # safe union if $ref has siblings
MAX_RESOLUTION_DEPTH: int = 5000            # guardrail for pathological specs

# Final pass: prune unused component definitions after dereferencing
PRUNE_UNUSED_COMPONENTS: bool = True
# Which component sections to consider for pruning
COMPONENT_SECTIONS: tuple[str, ...] = (
    "schemas",
    "responses",
    "parameters",
    "examples",
    "requestBodies",
    "headers",
    "securitySchemes",
    "links",
    "callbacks",
    "pathItems",  # OAS 3.1
)


# ──────────────────────────────────────────────────────────────────────────────
# YAML dumper tweaks (preserve multiline strings & indent lists under keys)
# ──────────────────────────────────────────────────────────────────────────────

class PrettyDumper(yaml.SafeDumper):
    """
    - Ensures lists under mapping keys are indented (no "indentless" sequences).
    - Emits multiline strings as block scalars (|) for readability.
    """
    # Force proper indentation for sequences nested under a mapping key
    def increase_indent(self, flow: bool = False, indentless: bool = False) -> None:  # noqa: D401
        # Always set indentless=False to indent "-" two spaces under the key.
        return super().increase_indent(flow, False)


def _represent_str_preserve_block_scalars(dumper: yaml.Dumper, data: str) -> yaml.nodes.ScalarNode:
    """
    Representer for Python `str` that emits block scalars (`|`) for multiline strings,
    keeping JSON-like examples and long descriptions readable.
    """
    style = '|' if '\n' in data else None
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style=style)


# Register the custom str representer on our PrettyDumper
PrettyDumper.add_representer(str, _represent_str_preserve_block_scalars)


# ──────────────────────────────────────────────────────────────────────────────
# Utilities
# ──────────────────────────────────────────────────────────────────────────────

def _decode_json_pointer_token(token: str) -> str:
    """Decode a single RFC 6901 token."""
    return token.replace('~1', '/').replace('~0', '~')


def json_pointer_get(doc: Any, pointer: str) -> Any:
    """
    Resolve a JSON Pointer (RFC 6901). Accepts leading '#' and empty pointers.

    Raises KeyError on failure.
    """
    if pointer == '' or pointer == '#':
        return doc
    if pointer.startswith('#'):
        pointer = pointer[1:]
    if not pointer.startswith('/'):
        raise KeyError(f"Invalid JSON pointer (must start with '/'): {pointer!r}")

    cur: Any = doc
    parts = pointer.split('/')[1:]
    for raw in parts:
        tok = _decode_json_pointer_token(raw)
        if isinstance(cur, dict):
            if tok not in cur:
                raise KeyError(f"Key {tok!r} not found while traversing pointer {pointer!r}")
            cur = cur[tok]
        elif isinstance(cur, list):
            if tok == '-':
                raise KeyError(f"'-' token not supported in pointer {pointer!r}")
            try:
                idx = int(tok)
            except ValueError as exc:
                raise KeyError(
                    f"Expected integer index in pointer for list, got {tok!r}"
                ) from exc
            if idx < 0 or idx >= len(cur):
                raise KeyError(f"Index {idx} out of range for list length {len(cur)}")
            cur = cur[idx]
        else:
            raise KeyError(
                f"Cannot traverse into non-container {type(cur)} at token {tok!r}"
            )
    return cur


def deep_merge(base: Any, overlay: Any, *, merge_required: bool = True) -> Any:
    """
    Deep-merge `overlay` onto `base` with predictable, safe semantics:
    - dict+dict => merge each key; dict vs dict => recursively merge
    - lists => overlay replaces base, except 'required' where we union (preserving order)
    - scalars => overlay replaces base
    """
    if isinstance(base, dict) and isinstance(overlay, dict):
        out: dict[str, Any] = dict(base)
        for k, v in overlay.items():
            if k in out:
                if isinstance(out[k], dict) and isinstance(v, dict):
                    out[k] = deep_merge(out[k], v, merge_required=merge_required)
                elif merge_required and k == 'required' and isinstance(out[k], list) and isinstance(v, list):
                    seen = set(out[k])
                    out[k] = out[k] + [item for item in v if item not in seen]
                else:
                    out[k] = copy.deepcopy(v)
            else:
                out[k] = copy.deepcopy(v)
        return out
    return copy.deepcopy(overlay)


def path_to_file_uri(path: str) -> str:
    """Convert a filesystem path to a file:// URI (cross-platform)."""
    return Path(path).absolute().as_uri()


def file_uri_to_path(uri: str) -> str:
    """Convert a file:// URI back to a filesystem path."""
    parsed = urlparse(uri)
    assert parsed.scheme == 'file', f"Not a file:// URI: {uri}"
    path = unquote(parsed.path)
    # Handle Windows-style '/C:/...' paths
    if path.startswith('/') and len(path) > 3 and path[2] == ':':
        path = path[1:]
    return path


def normalize_ref(ref: str, current_base_uri: str) -> tuple[str, str]:
    """
    Normalize a $ref against the current base URI.
    Returns (doc_uri, fragment) where fragment includes leading '#' or '' if none.
    """
    if not ref:
        return current_base_uri, ''
    if '#' in ref:
        res, frag = ref.split('#', 1)
        frag = '#' + frag
    else:
        res, frag = ref, ''
    doc_uri = urljoin(current_base_uri, res) if res else current_base_uri
    return doc_uri, frag


def is_ref_node(node: Any) -> bool:
    return isinstance(node, dict) and '$ref' in node and isinstance(node['$ref'], str)


# ──────────────────────────────────────────────────────────────────────────────
# Core dereferencer
# ──────────────────────────────────────────────────────────────────────────────

class Dereferencer:
    """
    Recursively de-reference $ref across an OpenAPI (or JSON Schema-like) YAML.

    Cycle handling:
      - If a cycle is detected, the resolver returns {"$ref": "...", "x-circular-ref": true}
        at the cycle point to break infinite recursion while still being readable.

    Caching:
      - To avoid caching incomplete/cycle-context expansions, entries are cached only when
        resolving from the top-level (no active stack) and there are no $ref sibling overlays.
    """

    def __init__(
        self,
        root_doc: Any,
        root_uri: str,
        *,
        add_x_resolved_from: bool = True,
        allow_http: bool = False,
        handle_external_refs: bool = True,
        merge_required_lists: bool = True,
        circular_placeholder: bool = True,
        max_depth: int = 5000,
    ) -> None:
        self.root_doc = root_doc
        self.root_uri = root_uri
        self.add_x_resolved_from = add_x_resolved_from
        self.allow_http = allow_http
        self.handle_external_refs = handle_external_refs
        self.merge_required_lists = merge_required_lists
        self.circular_placeholder = circular_placeholder
        self.max_depth = max_depth

        self._doc_cache: dict[str, Any] = {root_uri: root_doc}
        self._res_cache: dict[str, Any] = {}
        self.stats: dict[str, int] = {'resolved': 0, 'circular': 0, 'unresolved': 0}
        self.warnings: list[str] = []

    # ── Loading docs ──────────────────────────────────────────────────────────

    def _load_doc(self, uri: str) -> Any:
        if uri in self._doc_cache:
            return self._doc_cache[uri]

        parsed = urlparse(uri)
        if parsed.scheme in ('http', 'https'):
            if not (self.handle_external_refs and self.allow_http):
                raise RuntimeError(f"HTTP(S) external refs are disabled for {uri}")
            import requests  # Lazy import
            resp = requests.get(uri, timeout=30)
            resp.raise_for_status()
            doc = yaml.safe_load(resp.text)
        elif parsed.scheme == 'file' or parsed.scheme == '':
            path = file_uri_to_path(uri) if parsed.scheme == 'file' else uri
            with open(path, 'r', encoding='utf-8') as f:
                doc = yaml.safe_load(f)
        else:
            raise RuntimeError(f"Unsupported URI scheme in $ref: {uri}")

        self._doc_cache[uri] = doc
        return doc

    # ── Public API ────────────────────────────────────────────────────────────

    def dereference(self) -> Any:
        """Return a deep, de-referenced copy of the root document."""
        return self._resolve_node(copy.deepcopy(self.root_doc), self.root_uri, stack=[])

    # ── Internal resolution ───────────────────────────────────────────────────

    def _resolve_node(self, node: Any, current_base_uri: str, stack: list[str]) -> Any:
        if len(stack) > self.max_depth:
            self.warnings.append(f"Max depth exceeded at base {current_base_uri}")
            return node

        if is_ref_node(node):
            return self._resolve_ref_node(node, current_base_uri, stack)

        if isinstance(node, dict):
            out: dict[str, Any] = {}
            for k, v in node.items():
                out[k] = self._resolve_node(v, current_base_uri, stack)
            return out

        if isinstance(node, list):
            return [self._resolve_node(item, current_base_uri, stack) for item in node]

        return node

    def _resolve_ref_node(self, node: dict[str, Any], current_base_uri: str, stack: list[str]) -> Any:
        ref = node['$ref']
        doc_uri, frag = normalize_ref(ref, current_base_uri)
        ref_key = f"{doc_uri}{frag}"

        # Cycle detection
        if ref_key in stack:
            self.stats['circular'] += 1
            if self.circular_placeholder:
                return {'$ref': ref, 'x-circular-ref': True}
            return node  # leave as-is

        overlay = {k: v for k, v in node.items() if k != '$ref'}

        # Cache policy: only when (a) no siblings overlay and (b) called from the top (stack empty)
        cache_allowed = (not overlay) and (len(stack) == 0)
        if cache_allowed and ref_key in self._res_cache:
            return copy.deepcopy(self._res_cache[ref_key])

        # Load & resolve
        try:
            doc = self._load_doc(doc_uri)
            target = doc if frag in ('', '#', None) else json_pointer_get(doc, frag)
        except Exception as exc:  # noqa: BLE001
            self.stats['unresolved'] += 1
            self.warnings.append(f"Failed to resolve $ref {ref!r} @ base {current_base_uri}: {exc}")
            return node

        # Resolve the target structure with this $ref on the stack
        stack.append(ref_key)
        resolved_target = self._resolve_node(copy.deepcopy(target), doc_uri, stack)
        stack.pop()

        resolved = resolved_target

        # Merge any sibling keys onto the resolved content
        if overlay:
            resolved_overlay = self._resolve_node(overlay, current_base_uri, stack)
            resolved = deep_merge(resolved, resolved_overlay, merge_required=self.merge_required_lists)

        # Annotate source of resolution
        if self.add_x_resolved_from and isinstance(resolved, dict) and 'x-resolved-from' not in resolved:
            resolved = {'x-resolved-from': ref, **resolved}

        if cache_allowed:
            self._res_cache[ref_key] = copy.deepcopy(resolved)

        self.stats['resolved'] += 1
        return resolved


# ──────────────────────────────────────────────────────────────────────────────
# Final pass: prune unused components
# ──────────────────────────────────────────────────────────────────────────────

def _parse_component_pointer(fragment: str) -> tuple[str, str] | None:
    """
    Given a fragment like '#/components/schemas/Foo/bar', return ('schemas','Foo').
    Returns None if not under components with a named item.
    """
    if not fragment or not fragment.startswith('#/'):
        return None
    parts = fragment[2:].split('/')  # drop leading '#/'
    if not parts or parts[0] != 'components':
        return None
    tokens = [_decode_json_pointer_token(p) for p in parts]
    if len(tokens) >= 3:
        section = tokens[1]
        name = tokens[2]
        return section, name
    return None


def _collect_used_component_roots(doc: Any, root_uri: str) -> set[tuple[str, str]]:
    """
    Scan the (already dereferenced) document and collect all component roots
    that are still referenced by:
      - any remaining `$ref` (e.g., cycle placeholders)
      - discriminator.mapping entries (string pointers or bare schema names)
      - security requirements (names of securitySchemes)
    Returns a set of (section, name), e.g., ('schemas', 'MySchema').
    """
    used: set[tuple[str, str]] = set()

    def walk(node: Any, base_uri: str) -> None:
        if isinstance(node, dict):
            # Collect $ref targets
            ref_val = node.get('$ref')
            if isinstance(ref_val, str):
                doc_uri, frag = normalize_ref(ref_val, base_uri)
                parsed = _parse_component_pointer(frag) if doc_uri == root_uri else None
                if parsed:
                    used.add(parsed)

            # Collect securitySchemes referenced by name via security requirements
            if 'security' in node and isinstance(node['security'], list):
                for req in node['security']:
                    if isinstance(req, dict):
                        for scheme_name in req.keys():
                            if isinstance(scheme_name, str) and scheme_name:
                                used.add(('securitySchemes', scheme_name))

            # Collect discriminator.mapping refs (supports either JSON Pointer or bare schema name)
            discr = node.get('discriminator')
            if isinstance(discr, dict):
                mapping = discr.get('mapping')
                if isinstance(mapping, dict):
                    for v in mapping.values():
                        if isinstance(v, str) and v:
                            # If value looks like a pointer, parse it; otherwise treat as schema name
                            doc_uri, frag = normalize_ref(v, base_uri)
                            parsed = _parse_component_pointer(frag) if doc_uri == root_uri else None
                            if parsed:
                                used.add(parsed)
                            else:
                                # Bare schema name (OAS 3.0 mapping semantics)
                                if '/' not in v and '#' not in v:
                                    used.add(('schemas', v))

            for k, v in node.items():
                # Recurse into children
                walk(v, base_uri)
        elif isinstance(node, list):
            for item in node:
                walk(item, base_uri)

    walk(doc, root_uri)
    return used


def _iter_component_items(
    components: dict[str, Any],
    sections: Iterable[str],
) -> Iterable[tuple[str, str]]:
    """
    Yield (section, name) for every standard component item present.
    Skips vendor extensions like 'x-*'.
    """
    for section in sections:
        bucket = components.get(section)
        if isinstance(bucket, dict):
            for name in bucket.keys():
                if isinstance(name, str) and not name.startswith('x-'):
                    yield section, name


def prune_unused_components_in_place(doc: Any, root_uri: str) -> dict[str, int]:
    """
    Remove entries from components/* that are not used anywhere in the doc after dereferencing.
    Preserves:
      - Anything still pointed to by a remaining $ref
      - Schema names referenced by discriminator.mapping
      - Security schemes referenced by security requirements
      - Vendor extension keys (x-*)
    Returns a dict of counts removed per section.
    """
    comps = doc.get('components')
    if not isinstance(comps, dict):
        return {}

    used = _collect_used_component_roots(doc, root_uri)
    removed_per_section: dict[str, int] = {s: 0 for s in COMPONENT_SECTIONS}

    # Remove unused items per section
    for section in list(comps.keys()):
        if section.startswith('x-'):
            # Preserve vendor extensions at the components level
            continue
        if section not in COMPONENT_SECTIONS:
            # Leave unknown/novel sections intact
            continue

        bucket = comps.get(section)
        if not isinstance(bucket, dict):
            # If it's not a map, drop it if it's falsy
            if not bucket:
                del comps[section]
            continue

        for name in list(bucket.keys()):
            if isinstance(name, str) and name.startswith('x-'):
                continue  # keep vendor extensions within each bucket
            if (section, name) not in used:
                del bucket[name]
                removed_per_section[section] = removed_per_section.get(section, 0) + 1

        # Drop empty buckets
        if isinstance(bucket, dict) and not bucket:
            del comps[section]

    # Drop empty components entirely (unless vendor extensions remain)
    if isinstance(comps, dict) and all(
        (k.startswith('x-') for k in comps.keys())
    ):
        # If only x-* keys left, you can choose to keep or drop.
        # We keep them, as they may carry metadata the user wants.
        pass
    elif isinstance(comps, dict) and not comps:
        del doc['components']

    # Trim zero-count sections from the report for tidiness
    return {k: v for k, v in removed_per_section.items() if v > 0}


# ──────────────────────────────────────────────────────────────────────────────
# Script entry
# ──────────────────────────────────────────────────────────────────────────────

def _coerce_openapi_version(doc: Any, override: str | None) -> None:
    """If override is set, replace doc['openapi'] with that value (if present)."""
    if not override:
        return
    if isinstance(doc, dict) and 'openapi' in doc and isinstance(doc['openapi'], str):
        doc['openapi'] = override


def main() -> None:
    # Allow deeper recursion for very nested schemas
    sys.setrecursionlimit(max(sys.getrecursionlimit(), MAX_RESOLUTION_DEPTH))

    # Load input YAML
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        root = yaml.safe_load(f)

    # Override OpenAPI version if requested
    _coerce_openapi_version(root, OPENAPI_VERSION_OVERRIDE)

    # Resolve refs
    base_uri = path_to_file_uri(INPUT_FILE)
    deref = Dereferencer(
        root_doc=root,
        root_uri=base_uri,
        add_x_resolved_from=ADD_X_RESOLVED_FROM,
        allow_http=ALLOW_HTTP_FETCH,
        handle_external_refs=HANDLE_EXTERNAL_REFS,
        merge_required_lists=MERGE_REQUIRED_LISTS,
        circular_placeholder=CIRCULAR_REF_PLACEHOLDER,
        max_depth=MAX_RESOLUTION_DEPTH,
    )
    result = deref.dereference()

    # Final pass: prune unused components
    pruned_counts: dict[str, int] = {}
    if PRUNE_UNUSED_COMPONENTS:
        pruned_counts = prune_unused_components_in_place(result, base_uri)

    # Write output YAML with preserved multiline blocks and proper indenting
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        yaml.dump(
            result,
            f,
            Dumper=PrettyDumper,         # <-- keeps examples as block scalars, indents lists
            sort_keys=False,
            allow_unicode=True,
            width=YAML_LINE_WIDTH,
            indent=YAML_INDENT,
        )

    # Console summary
    print(f"Wrote flattened spec to: {OUTPUT_FILE}")
    print(
        f"Stats: resolved={deref.stats['resolved']}, "
        f"circular={deref.stats['circular']}, unresolved={deref.stats['unresolved']}"
    )
    if PRUNE_UNUSED_COMPONENTS:
        total_removed = sum(pruned_counts.values())
        print(f"Pruned unused components: {total_removed}")
        if pruned_counts:
            for section, n in sorted(pruned_counts.items()):
                print(f"  - {section}: {n}")

    if deref.warnings:
        print("\nWarnings:")
        for w in deref.warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
