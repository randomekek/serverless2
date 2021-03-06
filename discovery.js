import {randomChars, mapRemove} from './util.js';

function randomPeerId() {
  return '-OH0001-' + randomChars(12);
}

const connectionSettings = {
  iceServers: [{urls:["stun:stun.l.google.com:19302"]}],
};

const minute = 60*1000;
const offerTimeout = 10*1000;
const offerPeriods = [0, 4*minute, 12*minute, 36*minute, 108*minute];
const heartbeatPeriod = 1*minute;
const peerCount = 5;

function Discovery(url, feed, onPeer, onPeerDisconnect) {
  let discoverySocket = makeSocket();
  const myPeerId = randomPeerId();
  const requestHeader = { action: 'announce', info_hash: feed, peer_id: myPeerId };
  const heartbeatRequest = JSON.stringify({ ...requestHeader, numwant: 0, offers: [] });
  const pendingPeers = new Map();
  const peers = new Map();
  let totalPeerCount = 0;
  let lastOfferTime = Date.now();
  let offerCounter = 0;

  function expireOffer(id, pc) {
    if (pendingPeers.has(id)) {
      pendingPeers.delete(id);
    }
    if (pc.connectionState != 'connected') {
      pc.close();
    }
  }
  function savePeer(peerId, peer) {
    function maybeSave() {
      if (peer.channel.readyState == 'open' && !peers.has(peerId)) {
        peer.pc.onconnectionstatechange = maybeRemove;
        peer.channel.onclose = maybeRemove;
        peers.set(peerId, peer);
        console.log('added a peer:', peerId);
        onPeer(peer);
      }
    }
    function maybeRemove() {
      if ((peer.pc.connectionState != 'connected' ||  peer.channel.readyState != 'open') && peers.has(peerId)) {
        console.log('removed a peer:', peerId);
        peers.delete(peerId);
        onPeerDisconnect(peer);
        offerCounter = 0;
      }
    }
    peer.id = peerId;
    peer.channel.onopen = maybeSave;
    maybeSave();
  }
  function getLocalDescription(pc) {
    return new Promise(function(resolve, reject) {
      pc.onicecandidate = e => {
        if (e.candidate == null) {
          resolve(pc.localDescription);
        }
      }
    });
  }
  async function sendOffer() {
    const numwant = Math.max(0, peerCount - peers.size);
    const offers = await Promise.all(new Array(numwant).fill(0).map(async x => {
      const pc = new RTCPeerConnection(connectionSettings);
      const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
      await pc.setLocalDescription(await pc.createOffer());
      const offer = await getLocalDescription(pc);
      const id = randomChars(20);
      pendingPeers.set(id, {pc, channel});
      setTimeout(() => expireOffer(id, pc), offerTimeout);
      return { offer_id: id, offer };
    }));
    discoverySocket.send(JSON.stringify({ ...requestHeader, numwant, offers }));
  }
  async function acceptOffer(data) {
    const pc = new RTCPeerConnection(connectionSettings);
    const channel = pc.createDataChannel('BUNDLE', {negotiated: true, id: 0});
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    await pc.setLocalDescription(await pc.createAnswer());
    const answer = await getLocalDescription(pc);
    savePeer(data.peer_id, {pc, channel});
    setTimeout(() => expireOffer('', pc), offerTimeout);
    discoverySocket.send(JSON.stringify({
      ...requestHeader,
      offer_id: data.offer_id,
      to_peer_id: data.peer_id,
      answer,
    }));
  }
  async function acceptAnswer(data) {
    const peer = mapRemove(pendingPeers, data.offer_id);
    await peer.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    savePeer(data.peer_id, peer);
  }
  function makeSocket() {
    console.log('makeSocket');
    const socket = new WebSocket(url);
    socket.onopen = heartbeat;
    socket.onmessage = e => {
      const data = JSON.parse(e.data);
      if (Number.isInteger(data.incomplete)) {
        totalPeerCount = data.incomplete - 1;
      }
      if (peers.has(data.peer_id)) {
        console.log('skipping peer', data.peer_id);
        return;
      } else if (data.offer) {
        acceptOffer(data);
      } else if (data.answer) {
        acceptAnswer(data);
      }
    };
    return socket;
  }
  function heartbeat() {
    const connected = discoverySocket.readyState == 1 /* OPEN */;
    if (connected) {
      const shouldOffer = (
        Date.now() > lastOfferTime + offerPeriods[Math.min(offerPeriods.length - 1, offerCounter)] &&
        peers.size < peerCount);
      if (shouldOffer) {
        lastOfferTime = Date.now();
        offerCounter++;
        sendOffer();
      } else {
        discoverySocket.send(heartbeatRequest);
      }
    } else {
      discoverySocket = makeSocket();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      heartbeat()
    }
  });
  setInterval(heartbeat, heartbeatPeriod);
  return { peerCount: () => ({ total: Math.max(totalPeerCount, peers.size), connected: peers.size }) };
}

export {Discovery};
