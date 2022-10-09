#!/usr/bin/env python3
#
# wsproxy - Websocket proxy for use with 
# Copyright (C) 2022 Svein Seldal
#
# SPDX-License-Identifier: MIT


import asyncio
import json
from autobahn.asyncio.websocket import WebSocketServerFactory, WebSocketServerProtocol


class BitbakeWSProtocol(WebSocketServerProtocol):

    MAX_LOG = 1000

    # def onConnect(self, request) -> None:
    #     print(f"Client connecting from {request.peer}")

    def onOpen(self):
        self.is_client = True
        self.client_id = self.factory.onClientOpen(self)

    def onClose(self, wasClean: bool, code, reason) -> None:
        print(f"#{self.client_id}  Connection to {self.peer} closed. "
              f"wasClean={wasClean}, code={code}, reason={reason}")
        if not wasClean:
            print(f"#{self.client_id}  Server connection was not closed cleanly")
        self.factory.onClientClose(self)

    def onMessage(self, payload, isBinary):
        if isBinary:
            print(f"#{self.client_id}  >> RX {len(payload)} bytes from {self.peer}")
            print(f"#{self.client_id}  Message error: Binary payload not supported")
            return

        # tp = payload.decode('utf8')
        # if len(payload) > self.MAX_LOG:
        #     tp = payload[0:self.MAX_LOG].decode('utf8') + ' ...'
        # print(f"{self.client_id}  >> RX  [{len(payload)}]  {tp}")

        try:
            data = json.loads(payload)
            self.factory.onClientMessage(self, data)
        except json.decoder.JSONDecodeError as err:
            print(f"#{self.client_id}  Message error: {err}")

    def sendMessage(self, data):
        super().sendMessage(json.dumps(data).encode('utf-8'))


class BitbakeWSServerFactory(WebSocketServerFactory):

    def __init__(self, *args, **kwargs):
        self.clients = []
        self.events = []
        self.protocol = BitbakeWSProtocol
        super().__init__(*args, **kwargs)

    def onClientOpen(self, client):
        client_id = len(self.clients)
        self.clients.append(client)
        print(f"#{client_id}  Registering remote client {client.peer}, {len(self.clients)} clients connected")
        return client_id

    def onClientClose(self, client):
        index = self.clients.index(client)
        if index >= 0:
            self.clients.pop(index)
        print(f"#{client.client_id}  Unregistering remote client {client.peer}, "
                 f"{len(self.clients)} clients remaining")

    def onClientMessage(self, client, data):
        # print(f"Received data from: {client}: {data}")

        cmd = data.get('command')
        if 'command' in data:
            if cmd == 'reset':
                client.is_client = False
                self.events = []
                data = {'event': 'Reset'}
            elif cmd == 'replay':
                size = len(json.dumps(self.events))
                print(f"#{client.client_id}  Replay of {len(self.events)} which is {size} bytes")
                client.sendMessage({'event': 'Replay', 'data': self.events})
                return
            else:
                print(f"#{client.client_id}  Unknown command '{cmd}'")
                return

        if 'event' in data:

            # Store the event for later 'reply' command
            # FIXME This can become very memory intensive, as every past event
            # and progress is stored. One idea is to only store the last
            # progress event of the progress types. OTOH that requires decoding
            # of the event progress formats in this file and it requires
            # some filtering on the events array.
            self.events.append(data)

            # Proxy event to all connected clients
            for cli in self.clients:
                if not cli.is_client or cli == client:
                    continue
                cli.sendMessage(data)
            return

        print(f"Unknown message from {client.client_id}: {data}")
    

async def main():

    factory = BitbakeWSServerFactory()
    factory.protocol = BitbakeWSProtocol

    loop = asyncio.get_running_loop()
    server = await loop.create_server(factory, '127.0.0.1', 9000)
    await server.serve_forever()


if __name__ == '__main__':
    asyncio.run(main())
