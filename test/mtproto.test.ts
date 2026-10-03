import { test } from 'node:test';
import assert from 'node:assert/strict';
import bigInt from 'big-integer';
import { Api } from 'telegram';
import { channelKey } from '../src/sources/mtproto.js';

test('mtproto: a channel from getDialogs and its message chatId map to the same key', () => {
    const channel = new Api.Channel({ id: bigInt(1234567), title: 't', photo: new Api.ChatPhotoEmpty(), date: 0, username: 'kpszsu' });
    const message = new Api.Message({ id: 1, peerId: new Api.PeerChannel({ channelId: bigInt(1234567) }), message: 'x', date: 0 });
    // GramJS marks channel ids (-100…) on message.chatId; the raw entity id is not marked.
    assert.equal(channelKey(channel), String(message.chatId));
});
