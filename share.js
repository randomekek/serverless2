import {Discovery} from './discovery.js';
import {Stub} from './stub.js';
import {Change, GetRecentChangesReq, GetRecentChangesResp, GetUnseenChangesReq, GetUnseenChangesResp} from './types.js';
import {base64Encode, promiseFn, join, clockLessThan} from './util.js';

async function Share(changes, tracker, feed, readKey, onChange, onConflict) {
  const stubs = new Map();
  async function saveLocalChange(changeBin) {
    const hash = base64Encode(await crypto.subtle.digest('SHA-256', changeBin));
    changes.saveChange(hash, changeBin);
  }
  async function applyRemoteChange(changeBin) {
    const hash = base64Encode(await crypto.subtle.digest('SHA-256', changeBin));
    if (changes.saveChange(hash, changeBin)) {
      onChange(hash, Change.read(changeBin));
    }
  }
  function byRowId(changes) {
    const map = new Map();
    for (const c of changes) {
      if (!map.has(c.rowId) || clockLessThan(map.get(c.rowId).clock, c.clock)) {
        map.set(c.rowId, c);
      }
    }
    return map;
  }
  function ChangeConflict() {
    const [fromLocalPromise, fromLocal] = promiseFn();
    const [fromRemotePromise, fromRemote]  = promiseFn();
    (async function() {
      const fromLocal = (await fromLocalPromise).map(x => Change.read(x));
      const fromRemote = (await fromRemotePromise).map(x => Change.read(x));
      const conflicts = [];
      join(byRowId(fromLocal), byRowId(fromRemote), (local, remote) => {
        if (clockLessThan(local.clock, remote.clock)) {
          conflicts.push(local);
        }
      });
      if (conflicts.length > 0) {
        onConflict(conflicts);
      }
    } ());
    return {fromLocal, fromRemote};
  }
  async function withStubLocked(stub, action) {
    if (!stub.syncing) {
      stub.syncing = true;
      await action();
      stub.syncing = false;
    }
  }
  const discovery = Discovery(tracker, feed, async peer => {
    const changeConflict = ChangeConflict();
    const stub = await Stub(peer, readKey, {
      getRecentChanges: [GetRecentChangesReq, GetRecentChangesResp, req => {
        return {changes: changes.changeList.slice(req.cursor), cursor: changes.changeList.length};
      }],
      getUnseenChanges: [GetUnseenChangesReq, GetUnseenChangesResp, req => {
        const missing = changes.getMissingChanges(req.bloomFilter);
        changeConflict.fromLocal(missing);
        return {changes: missing, cursor: changes.changeList.length};
      }],
    });
    withStubLocked(stub, async () => {
      stubs.set(peer.id, stub);
      const resp = await stub.getUnseenChanges({bloomFilter: changes.getBloomFilter()});
      changeConflict.fromRemote(resp.changes);
      stub.cursor = resp.cursor;
      resp.changes.map(change => applyRemoteChange(change));
    });
  }, peer => {
    stubs.delete(peer.id);
  });
  setInterval(() => {
    for (const [peerId, stub] of stubs) {
      withStubLocked(stub, async () => {
        const resp = await stub.getRecentChanges({cursor: stub.cursor});
        stub.cursor = resp.cursor;
        resp.changes.map(change => applyRemoteChange(change));
      });
    }
  }, 1*1000);
  return {saveLocalChange, peerCount: () => stubs.size}
}

export {Share};
