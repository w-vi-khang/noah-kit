import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import fsPromises, { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PERMISSION_RULES, applyPermissions, classifySettings, createSettings, inspectSettings } from '../src/claude-permissions.js';

const STATE_RULE = 'Read(~/.noah-kit/state.json)';
const VERSIONS_RULE = 'Read(~/.noah-kit/versions/**)';
const EXPECTED_BYTES = `${JSON.stringify({ permissions: { allow: [STATE_RULE, VERSIONS_RULE] } }, null, 2)}\n`;
const cliPath = fileURLToPath(new URL('../src/main.js', import.meta.url));

// Originals captured before any test patches them, to check that every patch
// is restored.
const ORIGINAL_FS_PROMISES = { lstat: fsPromises.lstat, unlink: fsPromises.unlink };
const ORIGINAL_FILE_HANDLE = await (async () => {
  const probe = await open(fileURLToPath(import.meta.url), 'r');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  return { prototype, writeFile: prototype.writeFile, stat: prototype.stat };
})();

test('the rule list is exactly the two approved read-only rules, in order', () => {
  assert.deepEqual(PERMISSION_RULES.map((entry) => entry.rule), [STATE_RULE, VERSIONS_RULE]);
});

test('every rule has a non-empty one-line reason and only the rule and reason fields', () => {
  for (const entry of PERMISSION_RULES) {
    assert.deepEqual(Object.keys(entry).sort(), ['reason', 'rule']);
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.trim().length > 0, `${entry.rule} needs a reason`);
    assert.doesNotMatch(entry.reason, /\n/);
  }
});

test('the rule list and its entries are frozen and cannot be changed', () => {
  assert.ok(Object.isFrozen(PERMISSION_RULES));
  for (const entry of PERMISSION_RULES) assert.ok(Object.isFrozen(entry));
  assert.throws(() => PERMISSION_RULES.push({ rule: 'Bash(*)', reason: 'x' }), TypeError);
  assert.throws(() => { PERMISSION_RULES[0].rule = 'Bash(*)'; }, TypeError);
  assert.equal(PERMISSION_RULES.length, 2);
  assert.equal(PERMISSION_RULES[0].rule, STATE_RULE);
});

test('no rule grants npx, Bash, Agent, defaultMode, bypass, WebFetch, or Edit', () => {
  for (const { rule } of PERMISSION_RULES) {
    for (const forbidden of ['npx', 'Bash', 'Agent', 'defaultMode', 'bypass', 'WebFetch', 'Edit']) {
      assert.ok(!rule.toLowerCase().includes(forbidden.toLowerCase()), `${rule} must not contain ${forbidden}`);
    }
    assert.match(rule, /^Read\(/, `${rule} must be a Read rule`);
  }
});

test('no rule holds an absolute or machine-specific path', () => {
  for (const { rule } of PERMISSION_RULES) {
    const specifier = /^Read\((.*)\)$/.exec(rule)[1];
    assert.doesNotMatch(specifier, /^\//, `${rule}: leading /`);
    assert.doesNotMatch(specifier, /^\/\//, `${rule}: leading //`);
    assert.doesNotMatch(specifier, /^[A-Za-z]:[\\/]/, `${rule}: drive letter`);
    assert.doesNotMatch(rule, /\/Users\b|\/home\b|\\Users\\/, `${rule}: machine path`);
    assert.ok(specifier.startsWith('~/'), `${rule} must be home-relative with ~/`);
  }
});

test('createSettings holds only permissions.allow with the rule strings', () => {
  const settings = createSettings();
  assert.deepEqual(settings, { permissions: { allow: [STATE_RULE, VERSIONS_RULE] } });
  assert.deepEqual(Object.keys(settings), ['permissions']);
  assert.deepEqual(Object.keys(settings.permissions), ['allow']);
});

test('classifies a file with every rule and extra user keys as already present', () => {
  const content = JSON.stringify({
    model: 'sonnet',
    permissions: { allow: ['Bash(ls)', STATE_RULE, VERSIONS_RULE], deny: ['Read(.env)'] },
    env: { A: '1' }
  });
  const result = classifySettings(content);
  assert.equal(result.status, 'ALREADY_PRESENT');
  assert.deepEqual(result.missing, []);
});

test('classifies a file with only some rules and lists exactly the missing ones', () => {
  const onlyState = classifySettings(JSON.stringify({ permissions: { allow: [STATE_RULE] } }));
  assert.equal(onlyState.status, 'CONFLICT_EXISTING_FILE');
  assert.deepEqual(onlyState.missing.map((entry) => entry.rule), [VERSIONS_RULE]);

  const onlyVersions = classifySettings(JSON.stringify({ permissions: { allow: ['Bash(ls)', VERSIONS_RULE] } }));
  assert.equal(onlyVersions.status, 'CONFLICT_EXISTING_FILE');
  assert.deepEqual(onlyVersions.missing.map((entry) => entry.rule), [STATE_RULE]);
});

test('a near-miss rule string does not count as present', () => {
  const result = classifySettings(JSON.stringify({ permissions: { allow: ['Read(~/.noah-kit/state.json) ', 'Read(~/.noah-kit/versions/*)'] } }));
  assert.equal(result.status, 'CONFLICT_EXISTING_FILE');
  assert.deepEqual(result.missing.map((entry) => entry.rule), [STATE_RULE, VERSIONS_RULE]);
});

test('classifies a valid object with no rules, no allow list, or no permissions as missing every rule', () => {
  for (const value of [{}, { permissions: {} }, { permissions: { allow: [] } }, { model: 'opus' }, { permissions: { deny: ['Read(.env)'] } }]) {
    const result = classifySettings(JSON.stringify(value));
    assert.equal(result.status, 'CONFLICT_EXISTING_FILE', JSON.stringify(value));
    assert.deepEqual(result.missing.map((entry) => entry.rule), [STATE_RULE, VERSIONS_RULE], JSON.stringify(value));
  }
});

test('classifies invalid JSON as an invalid file that is not valid JSON', () => {
  for (const content of ['{ invalid', '', '   ', '{"permissions": {"allow": [}}']) {
    const result = classifySettings(content);
    assert.equal(result.status, 'CONFLICT_INVALID_FILE', JSON.stringify(content));
    assert.deepEqual(result.missing, []);
    assert.match(result.detail, /not valid JSON/);
  }
});

test('classifies a non-object top level (array, null, string, number, boolean) as an invalid file', () => {
  for (const content of ['[]', '[1]', 'null', '"text"', '42', 'true']) {
    const result = classifySettings(content);
    assert.equal(result.status, 'CONFLICT_INVALID_FILE', content);
    assert.deepEqual(result.missing, []);
    assert.match(result.detail, /JSON object/);
  }
});

test('classifies a permissions value that is not an object as an invalid file', () => {
  for (const permissions of [null, [], 'allow', 7, true]) {
    const result = classifySettings(JSON.stringify({ permissions }));
    assert.equal(result.status, 'CONFLICT_INVALID_FILE', JSON.stringify(permissions));
    assert.deepEqual(result.missing, []);
    assert.match(result.detail, /permissions/);
  }
});

test('classifies an allow value that is not an array as an invalid file', () => {
  for (const allow of [null, {}, 'Read(~/.noah-kit/state.json)', 7, true]) {
    const result = classifySettings(JSON.stringify({ permissions: { allow } }));
    assert.equal(result.status, 'CONFLICT_INVALID_FILE', JSON.stringify(allow));
    assert.deepEqual(result.missing, []);
    assert.match(result.detail, /allow/);
  }
});

test('the classifier does not mutate or depend on the rule list across calls', () => {
  const before = JSON.stringify(PERMISSION_RULES);
  classifySettings(JSON.stringify({ permissions: { allow: [STATE_RULE] } }));
  classifySettings('not json');
  assert.equal(JSON.stringify(PERMISSION_RULES), before);
});

test('drift: the generated rule still reads the local state file the proposed rules cover', async () => {
  const canonical = await readFile(new URL('../.claude/rules/noah-kit.md', import.meta.url), 'utf8');
  const stateRule = PERMISSION_RULES.find((entry) => entry.rule.includes('state.json'));
  assert.ok(stateRule, 'a rule must cover the local state file');
  const coveredPath = /^Read\((.*)\)$/.exec(stateRule.rule)[1];
  assert.ok(canonical.includes(`\`${coveredPath}\``), `the rule template must still name ${coveredPath}`);
  assert.match(canonical, /`core-manifest\.json`/);
  assert.match(canonical, /`src\/cli\.js`/);
});

// --- inspectSettings and applyPermissions: races, loops, and cleanup ---

async function withInitializedProject(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'noah-kit-permissions-test-'));
  try {
    const init = spawnSync(process.execPath, [cliPath, 'init', '--cwd', root], {
      encoding: 'utf8',
      env: { ...process.env, NOAH_HOME: path.join(root, '.test-noah-home') }
    });
    assert.equal(init.status, 0, init.stderr);
    await callback(root, path.join(root, '.claude', 'settings.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Replaces a node:fs/promises export for the module under test, which imports
// it by name, and restores the original afterwards.
async function withPatchedFsPromises(name, makeReplacement, callback) {
  const original = fsPromises[name];
  fsPromises[name] = makeReplacement(original);
  syncBuiltinESMExports();
  try {
    return await callback();
  } finally {
    fsPromises[name] = original;
    syncBuiltinESMExports();
  }
}

// Replaces a FileHandle prototype method and restores the original afterwards.
async function withPatchedFileHandle(name, makeReplacement, callback) {
  const probe = await open(fileURLToPath(import.meta.url), 'r');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const original = prototype[name];
  prototype[name] = makeReplacement(original);
  try {
    return await callback();
  } finally {
    prototype[name] = original;
  }
}

// Every path under root with its file content, sorted, for before/after checks.
function snapshotTree(root) {
  return readdirSync(root, { recursive: true }).sort().map((entry) => {
    const full = path.join(root, entry);
    const stats = lstatSync(full);
    if (stats.isFile()) return [entry, readFileSync(full, 'utf8')];
    return [entry, stats.isDirectory() ? '<directory>' : '<other>'];
  });
}

function enoent(file) {
  return Object.assign(new Error(`ENOENT: no such file or directory, lstat '${file}'`), { code: 'ENOENT', path: file });
}

function symlinkOrSkip(t, target, linkPath) {
  if (process.platform === 'win32') {
    t.skip('Self-referential symbolic-link loop behavior is not portable on Windows.');
    return false;
  }
  try {
    symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || process.platform === 'win32') {
      t.skip(`Symbolic links are not permitted here: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('two concurrent applies that both inspect before either creates: exactly one creates the file, the other overwrites nothing', async () => {
  await withInitializedProject(async (root, target) => {
    // Hold both inspections of settings.json until both have observed the
    // missing file, so both reach the exclusive create.
    const observed = [];
    let release;
    const bothInspected = new Promise((resolve) => { release = resolve; });
    const results = await withPatchedFsPromises('lstat', (original) => async (file, ...rest) => {
      if (file !== target || observed.length >= 2) return original(file, ...rest);
      const outcome = original(file, ...rest).then((value) => ({ value }), (error) => ({ error }));
      observed.push(outcome);
      if (observed.length === 2) release();
      await bothInspected;
      await Promise.all(observed);
      const { value, error } = await outcome;
      if (error) throw error;
      return value;
    }, () => Promise.allSettled([applyPermissions(root), applyPermissions(root)]));

    assert.equal(observed.length, 2, 'both applies inspected settings.json');
    for (const outcome of observed) assert.equal((await outcome).error?.code, 'ENOENT', 'both inspections saw no settings file');
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1, `exactly one apply succeeds: ${JSON.stringify(results.map((result) => result.status))}`);
    assert.equal(rejected.length, 1);
    assert.equal(fulfilled[0].value.status, 'CREATED');
    const message = rejected[0].reason.message;
    assert.ok(message.startsWith(`Could not create ${target}. No existing file was overwritten. Review ${path.dirname(target)} before retrying. Original error: `), message);
    assert.match(message, /EEXIST/);
    assert.equal(readFileSync(target, 'utf8'), EXPECTED_BYTES);
  });
});

test('a settings.json created after the inspection found none is not overwritten', async () => {
  await withInitializedProject(async (root, target) => {
    const userContent = '{ "created": "by another process after the inspection" }\n';
    let inspections = 0;
    await withPatchedFsPromises('lstat', (original) => async (file, ...rest) => {
      if (file !== target || inspections > 0) return original(file, ...rest);
      inspections += 1;
      try {
        return await original(file, ...rest);
      } finally {
        writeFileSync(target, userContent, { flag: 'wx' });
      }
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.ok(error.message.startsWith(`Could not create ${target}. No existing file was overwritten.`), error.message);
        assert.match(error.message, /EEXIST/);
        return true;
      });
    });

    assert.equal(inspections, 1, 'the inspection looked at settings.json before it existed');
    assert.equal(readFileSync(target, 'utf8'), userContent);
  });
});

test('a symbolic link placed at settings.json after the inspection is not followed and its target is not created', async (t) => {
  await withInitializedProject(async (root, target) => {
    if (!symlinkOrSkip(t, path.join(root, 'probe-target'), path.join(root, 'probe-link'))) return;
    unlinkSync(path.join(root, 'probe-link'));
    const outside = path.join(root, 'outside', 'settings.json');
    let linked = 0;
    await withPatchedFsPromises('lstat', (original) => async (file, ...rest) => {
      if (file !== target || linked > 0) return original(file, ...rest);
      linked += 1;
      try {
        return await original(file, ...rest);
      } finally {
        symlinkSync(outside, target);
      }
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.ok(error.message.startsWith(`Could not create ${target}. No existing file was overwritten.`), error.message);
        return true;
      });
    });

    assert.equal(linked, 1, 'the inspection looked at settings.json before the link existed');
    assert.equal(existsSync(path.dirname(outside)), false, 'the link target directory must not be created');
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), outside);
  });
});

test('.claude replaced by a regular file after the inspection: the apply fails and keeps the file', async () => {
  await withInitializedProject(async (root, target) => {
    const directory = path.dirname(target);
    await rm(directory, { recursive: true });
    await writeFile(directory, 'user file, not a directory');
    let faked = 0;
    await withPatchedFsPromises('lstat', (original) => async (file, ...rest) => {
      if (file === directory && faked === 0) {
        faked += 1;
        throw enoent(file);
      }
      return original(file, ...rest);
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.ok(error.message.startsWith(`Could not create ${target}. No existing file was overwritten. Review ${directory} before retrying.`), error.message);
        return true;
      });
    });

    assert.equal(faked, 1);
    assert.equal(lstatSync(directory).isFile(), true);
    assert.equal(readFileSync(directory, 'utf8'), 'user file, not a directory');
  });
});

test('a symbolic link loop above .claude is reported as an invalid file, not thrown', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'noah-kit-permissions-test-'));
  try {
    const loop = path.join(base, 'loop');
    if (!symlinkOrSkip(t, loop, loop)) return;

    const inspection = await inspectSettings(loop);

    assert.equal(inspection.status, 'CONFLICT_INVALID_FILE');
    assert.equal(inspection.detail, '.claude could not be inspected because of a symbolic link loop; Noah Kit does not follow it.');
    await assert.rejects(applyPermissions(loop), /Nothing was changed\.$/);
    assert.deepEqual(readdirSync(base), ['loop']);
    assert.equal(readlinkSync(loop), loop);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('settings.json lstat failing with ENOTDIR or ELOOP after .claude looked like a directory is reported as an invalid file', async (t) => {
  await withInitializedProject(async (root, target) => {
    const directory = path.dirname(target);
    // .claude is inspected as if it were a directory; the real path is not.
    const directoryLooksFine = (original) => async (file, ...rest) => original(file === directory ? root : file, ...rest);

    await rm(directory, { recursive: true });
    await writeFile(directory, 'user file');
    const notDirectory = await withPatchedFsPromises('lstat', directoryLooksFine, () => inspectSettings(root));
    assert.equal(notDirectory.status, 'CONFLICT_INVALID_FILE');
    assert.equal(notDirectory.detail, '.claude exists but is not a directory.');
    assert.equal(readFileSync(directory, 'utf8'), 'user file');

    await rm(directory);
    if (!symlinkOrSkip(t, directory, directory)) return;
    const loop = await withPatchedFsPromises('lstat', directoryLooksFine, () => inspectSettings(root));
    assert.equal(loop.status, 'CONFLICT_INVALID_FILE');
    assert.equal(loop.detail, '.claude/settings.json could not be inspected because of a symbolic link loop; Noah Kit does not follow it.');
    assert.equal(readlinkSync(directory), directory);
  });
});

test('an unexpected lstat error is passed on, and the apply creates nothing', async () => {
  await withInitializedProject(async (root, target) => {
    const directory = path.dirname(target);
    const denied = (original) => async (file, ...rest) => {
      if (file === directory) throw Object.assign(new Error(`EACCES: permission denied, lstat '${file}'`), { code: 'EACCES' });
      return original(file, ...rest);
    };
    const before = snapshotTree(root);

    await withPatchedFsPromises('lstat', denied, async () => {
      await assert.rejects(inspectSettings(root), { code: 'EACCES' });
      await assert.rejects(applyPermissions(root), { code: 'EACCES' });
    });

    assert.deepEqual(snapshotTree(root), before);
  });
});

test('a write failure after the exclusive create removes only the file this run created', async () => {
  await withInitializedProject(async (root, target) => {
    writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{ "keep": true }\n');
    const before = snapshotTree(root);
    let writes = 0;

    await withPatchedFileHandle('writeFile', (original) => async function (...args) {
      writes += 1;
      assert.equal(lstatSync(target).isFile(), true, 'the file exists when the write starts');
      await original.call(this, '{ "permissions": {', 'utf8');
      throw new Error('simulated write failure');
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.equal(error.message, `Could not write ${target}. Removed the incomplete file that this run created. No existing file was overwritten. Original error: simulated write failure`);
        return true;
      });
    });

    assert.equal(writes, 1);
    assert.equal(existsSync(target), false, 'the incomplete file is removed');
    assert.deepEqual(snapshotTree(root), before, 'nothing else under the project changed');
  });
});

test('a write failure does not remove a path that another file replaced before the failure', async () => {
  await withInitializedProject(async (root, target) => {
    const moved = path.join(root, 'moved-created-file.json');
    const userContent = '{ "replaced": "by the user" }\n';

    await withPatchedFileHandle('writeFile', () => async function () {
      // The file this run created keeps its inode at `moved`; a different file
      // now has the settings path.
      renameSync(target, moved);
      writeFileSync(target, userContent, { flag: 'wx' });
      throw new Error('simulated write failure');
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.equal(error.message, `Could not write ${target}. The path no longer names the file this run created, so it was not removed. Review it before retrying. No existing file was overwritten. Original error: simulated write failure`);
        return true;
      });
    });

    assert.equal(readFileSync(target, 'utf8'), userContent);
    assert.equal(lstatSync(moved).isFile(), true, 'the created file is not removed under its new name either');
  });
});

test('a write failure after the created file was already removed reports that it no longer exists', async () => {
  await withInitializedProject(async (root, target) => {
    await withPatchedFileHandle('writeFile', () => async function () {
      unlinkSync(target);
      throw new Error('simulated write failure');
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.equal(error.message, `Could not write ${target}. The file this run created no longer exists. No existing file was overwritten. Original error: simulated write failure`);
        return true;
      });
    });

    assert.equal(existsSync(target), false);
  });
});

test('a failure to remove the incomplete file is reported, and the file is left for the user', async () => {
  await withInitializedProject(async (root, target) => {
    let unlinkAttempts = 0;
    await withPatchedFsPromises('unlink', (original) => async (file, ...rest) => {
      if (file !== target) return original(file, ...rest);
      unlinkAttempts += 1;
      throw Object.assign(new Error('simulated unlink failure'), { code: 'EPERM' });
    }, () => withPatchedFileHandle('writeFile', () => async function () {
      throw new Error('simulated write failure');
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.equal(error.message, `Could not write ${target}. Could not remove the incomplete file that this run created (simulated unlink failure). Remove it before retrying. No existing file was overwritten. Original error: simulated write failure`);
        return true;
      });
    }));

    assert.equal(unlinkAttempts, 1);
    assert.equal(lstatSync(target).isFile(), true);
  });
});

test('a stat failure after the exclusive create leaves the file in place and says so', async () => {
  await withInitializedProject(async (root, target) => {
    let stats = 0;
    await withPatchedFileHandle('stat', () => async function () {
      stats += 1;
      throw new Error('simulated stat failure');
    }, async () => {
      await assert.rejects(applyPermissions(root), (error) => {
        assert.equal(error.message, `Could not write ${target}. Could not confirm that the path still names the file this run created, so it was not removed. Review it before retrying. No existing file was overwritten. Original error: simulated stat failure`);
        return true;
      });
    });

    assert.equal(stats, 1);
    const left = lstatSync(target);
    assert.equal(left.isFile(), true, 'the file is left in place');
    assert.equal(left.size, 0);
  });
});

test('the FileHandle and node:fs/promises patches are restored after each test', async () => {
  assert.equal(fsPromises.lstat, ORIGINAL_FS_PROMISES.lstat);
  assert.equal(fsPromises.unlink, ORIGINAL_FS_PROMISES.unlink);
  const namespace = await import('node:fs/promises');
  assert.equal(namespace.lstat, ORIGINAL_FS_PROMISES.lstat, 'the named export is synced back');
  assert.equal(namespace.unlink, ORIGINAL_FS_PROMISES.unlink, 'the named export is synced back');
  assert.equal(ORIGINAL_FILE_HANDLE.prototype.writeFile, ORIGINAL_FILE_HANDLE.writeFile);
  assert.equal(ORIGINAL_FILE_HANDLE.prototype.stat, ORIGINAL_FILE_HANDLE.stat);
});
