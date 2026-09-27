"""Sample document sets served from an allow-list manifest (sample-documents/manifest.json)."""
import copy
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SAMPLES_DIR = ROOT / 'sample-documents'
MANIFEST = SAMPLES_DIR / 'manifest.json'
ROLES = ('invoice', 'purchase_order', 'receiving_record')


def _load():
    with open(MANIFEST, encoding='utf-8') as handle:
        return json.load(handle)


def _path(relative):
    """Resolve a manifest path; must stay inside the repository and exist."""
    path = (SAMPLES_DIR / relative).resolve()
    if ROOT not in path.parents or not path.is_file():
        return None
    return path


def url(sample_id, role):
    return f'/api/samples/{sample_id}/{role}'


def manifest():
    """Body of GET /api/samples: {"samples":[...]} with urls filled in; unavailable files are dropped."""
    samples = []
    for sample in _load().get('samples', []):
        entry = {k: copy.deepcopy(v) for k, v in sample.items() if k != 'files'}
        entry['files'] = {}
        for role, spec in sample.get('files', {}).items():
            if role in ROLES and _path(spec['path']):
                entry['files'][role] = {'path': spec['path'], 'url': url(sample['id'], role), 'content_type': spec['content_type']}
        if 'invoice' in entry['files']:
            samples.append(entry)
    return {'samples': samples}


def resolve(sample_id, role):
    """(path, content_type) for a manifest-listed file, else None. Never touches unlisted paths."""
    if not isinstance(sample_id, str) or not isinstance(role, str) or role not in ROLES:
        return None
    for sample in _load().get('samples', []):
        if sample.get('id') == sample_id:
            spec = sample.get('files', {}).get(role)
            if not spec:
                return None
            path = _path(spec['path'])
            return (path, spec['content_type']) if path else None
    return None


def match(sample_id, role, blob):
    """sources[role].sample object when the uploaded bytes equal the manifest file for (sample_id, role), else None."""
    found = resolve(sample_id, role)
    if not found or not isinstance(blob, (bytes, bytearray)):
        return None
    if hashlib.sha256(found[0].read_bytes()).digest() != hashlib.sha256(bytes(blob)).digest():
        return None
    return {'id': sample_id, 'role': role, 'url': url(sample_id, role)}
