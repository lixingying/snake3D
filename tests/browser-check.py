"""Real Chromium/WebGL smoke checks; Python stdlib only.
Run: python3 tests/browser-check.py --output /tmp/snake3d-browser-check
"""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


class Page:
    def __init__(self, url):
        from urllib.parse import urlparse
        parsed = urlparse(url)
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=40)
        key = base64.b64encode(os.urandom(16)).decode()
        self.socket.sendall((f'GET {parsed.path} HTTP/1.1\r\nHost: {parsed.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        header = b''
        while not header.endswith(b'\r\n\r\n'):
            header += self.socket.recv(1)
        if not header.startswith(b'HTTP/1.1 101 '):
            raise RuntimeError(header.decode())
        self.serial = 0
        self.errors = []

    def read(self, count):
        data = b''
        while len(data) < count:
            chunk = self.socket.recv(count - len(data))
            if not chunk:
                raise RuntimeError('Browser connection closed')
            data += chunk
        return data

    def call(self, method, params=None):
        self.serial += 1
        payload = json.dumps({'id': self.serial, 'method': method, 'params': params or {}}).encode()
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x81, 0x80 | length]) if length < 126 else bytes([0x81, 0xfe]) + struct.pack('!H', length) if length < 65536 else bytes([0x81, 0xff]) + struct.pack('!Q', length)
        self.socket.sendall(header + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))
        while True:
            first, second = self.read(2)
            size = second & 127
            if size == 126:
                size = struct.unpack('!H', self.read(2))[0]
            elif size == 127:
                size = struct.unpack('!Q', self.read(8))[0]
            data = self.read(size)
            if first & 15 == 8:
                raise RuntimeError('Browser closed WebSocket')
            message = json.loads(data)
            if message.get('method') == 'Runtime.exceptionThrown':
                self.errors.append(message['params'])
            if message.get('method') == 'Runtime.consoleAPICalled' and message['params']['type'] == 'error':
                self.errors.append(message['params'])
            if message.get('id') == self.serial:
                if 'error' in message:
                    raise RuntimeError(message['error'])
                return message.get('result', {})

    def js(self, expression):
        result = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True})
        if result.get('exceptionDetails'):
            raise RuntimeError(result['exceptionDetails'])
        return result.get('result', {}).get('value')

    def screenshot(self, destination):
        result = self.call('Page.captureScreenshot', {'format': 'png', 'fromSurface': True})
        destination.write_bytes(base64.b64decode(result['data']))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='/tmp/snake3d-browser-check')
    parser.add_argument('--maps', default='torus,sphere,mobius,projective,klein,genus2')
    parser.add_argument('--mobile-map', default='torus')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    chrome = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    with tempfile.TemporaryDirectory(prefix='snake3d-chrome-') as profile:
        log = (output / 'chrome.log').open('w')
        process = subprocess.Popen([chrome, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], stdout=log, stderr=log)
        try:
            port_file = Path(profile) / 'DevToolsActivePort'
            deadline = time.monotonic() + 20
            while not port_file.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError('Chrome could not start; see chrome.log')
                time.sleep(.1)
            port = port_file.read_text().splitlines()[0]
            tabs = json.load(urllib.request.urlopen('http://127.0.0.1:' + port + '/json'))
            page = Page(next(tab['webSocketDebuggerUrl'] for tab in tabs if tab['type'] == 'page'))
            page.call('Page.enable')
            page.call('Runtime.enable')
            page.call('Emulation.setDeviceMetricsOverride', {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            reports = []
            for kind in args.maps.split(','):
                page.errors.clear()
                page.call('Page.navigate', {'url': (ROOT / 'snake3d.html').as_uri() + '?map=' + kind + '&lang=zh&debug=1'})
                deadline = time.monotonic() + 35
                while not page.js('!!window.snakeDebug'):
                    if time.monotonic() > deadline:
                        raise RuntimeError(f'{kind} failed to load: {page.errors}')
                    time.sleep(.1)
                page.js("window.snakeDebug.game.setPaused(true); var qaStyle=document.createElement('style'); qaStyle.textContent='#pauseOverlay{display:none!important}'; document.head.appendChild(qaStyle)")
                time.sleep(.15)
                report = page.js('''(() => {
                  const d = window.snakeDebug, state = d.game.state();
                  const bad = [];
                  for (const actors of [d.clayActors, d.portalActors].filter(Boolean))
                    actors.group.traverse(o => { if (![...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].every(Number.isFinite)) bad.push(o.name); });
                  const canvas = document.getElementById('canvas-container').getBoundingClientRect(), chart = document.getElementById('map-panel').getBoundingClientRect();
                  const heads = [];
                  d.clayActors.group.parent.traverse(o => {if (o.name === 'snake-head') heads.push(o);});
                  return { map: new URLSearchParams(location.search).get('map'), invalidObjects: bad, fruits: d.clayActors.group.children.filter(o => o.name === 'fruit' && o.visible).length, separated: canvas.right <= chart.left, bodyPoints: d.chartView.snapshot.body.filter(Boolean).length, snakeHeads: heads.length, portals: state.portals.length };
                })()''')
                assert not report['invalidObjects'], report
                assert report['fruits'] > 0 and report['separated'], report
                assert report['snakeHeads'] == 1, report
                assert report['portals'] == (1 if kind == 'projective' else 0), report
                page.screenshot(output / (kind + '.png'))
                report['steering'] = {}
                for key, sign in [('ArrowLeft', -1), ('ArrowRight', 1)]:
                    page.call('Input.dispatchKeyEvent', {'type': 'keyDown', 'key': key, 'code': key})
                    turn = page.js('''(() => {
                      const d=window.snakeDebug, state=d.game.state(), f=d.surfaceFrame(state.head);
                      const straight=d.surfaceFrame(d.navigation.move(state.head,state.speed/120).point).forward;
                      d.game.setPaused(false); d.game.update(1/120); d.game.setPaused(true);
                      d.clayActors.update(performance.now());
                      const actor=d.clayActors.group.getObjectByName('snake-head');
                      const parent=d.clayActors.group; parent.updateWorldMatrix(true,true);
                      const forward=new d.THREE.Vector3(0,0,1).applyQuaternion(actor.getWorldQuaternion(new d.THREE.Quaternion()));
                      const centre=parent.localToWorld(f.position.clone());
                      const normal=f.normal.clone().transformDirection(parent.matrixWorld);
                      const camera=new d.THREE.PerspectiveCamera(45,1,.01,30);
                      camera.position.copy(centre).addScaledVector(normal,3);
                      camera.up.copy(f.forward).transformDirection(parent.matrixWorld);
                      camera.lookAt(centre); camera.updateMatrixWorld(true);
                      // Project the actual 3D head model from above the snake.
                      const actual=centre.clone().addScaledVector(forward,.2).project(camera);
                      const baseline=centre.clone().addScaledVector(straight.transformDirection(parent.matrixWorld),.2).project(camera);
                      return actual.x-baseline.x;
                    })()''')
                    page.call('Input.dispatchKeyEvent', {'type': 'keyUp', 'key': key, 'code': key})
                    assert sign * turn > .0001, (kind, key, '3D head turns the wrong way viewed from above', turn)
                    report['steering'][key] = turn
                seam = page.js("""(() => {
                  const d = window.snakeDebug, face = d.game.state().head.face;
                  const start = d.navigation.seed(.998, .37, face); start.dv = .2;
                  d.game.reset(start); d.chartView.reset();
                  const before = {u: d.game.state().head.u, v: d.game.state().head.v, face: d.game.state().head.face};
                  d.game.setPaused(false);
                  for(let i=0;i<72;i++) d.game.update(1/120);
                  d.game.setPaused(true);
                  return {before, after: {u:d.game.state().head.u,v:d.game.state().head.v,face:d.game.state().head.face}, running:d.game.state().running};
                })()""")
                page.js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                invalid = page.js("(() => {const bad=[];const d=window.snakeDebug;for(const actors of [d.clayActors,d.portalActors].filter(Boolean))actors.group.traverse(o => {if(![...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray()].every(Number.isFinite))bad.push(o.name);});return bad;})()")
                assert not invalid, (kind, 'invalid seam render', invalid)
                page.screenshot(output / (kind + '-seam.png'))
                report['seam'] = seam
                if kind == 'projective':
                    passage = page.js('''(() => {
                      const d=window.snakeDebug, nav=d.navigation;
                      d.game.reset(nav.seed(.5,.5));
                      const state=d.game.state(), target=nav.move(state.head,.23).point;
                      state.portals.splice(0,state.portals.length,{...target,id:99,radius:state.portalConfig.radius,age:0,lifetime:state.portalConfig.lifetime,heldActive:false});
                      for(let i=0;i<30;i++) d.game.update(1/120);
                      d.game.setPaused(true);
                      const after=d.game.state();
                      return {headSide:after.head.side,tailSide:after.snake.at(-1).side,passages:after.passages.length};
                    })()''')
                    assert passage == {'headSide': -1, 'tailSide': 1, 'passages': 1}, passage
                    page.js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                    assert page.js('window.snakeDebug.chartView.snapshot.portals.length') == 1
                    page.screenshot(output / 'projective-passage.png')
                    report['passage'] = passage
                report['pageErrors'] = page.errors
                assert not page.errors, report
                reports.append(report)
                print(json.dumps(report), flush=True)
            page.call('Emulation.setDeviceMetricsOverride', {'width': 390, 'height': 844, 'deviceScaleFactor': 2, 'mobile': True})
            page.call('Emulation.setTouchEmulationEnabled', {'enabled': True})
            page.call('Page.navigate', {'url': (ROOT / 'snake3d.html').as_uri() + '?map=' + args.mobile_map + '&lang=zh&debug=1'})
            for attempt in range(350):
                if page.js('!!window.snakeDebug'):
                    break
                time.sleep(.1)
            page.js("window.snakeDebug.game.setPaused(true); var qaStyle=document.createElement('style'); qaStyle.textContent='#pauseOverlay{display:none!important}'; document.head.appendChild(qaStyle)")
            time.sleep(.2)
            mobile = page.js("(() => {const a=document.getElementById('canvas-container').getBoundingClientRect(),b=document.getElementById('map-panel').getBoundingClientRect();return {a:[a.left,a.top,a.right,a.bottom],b:[b.left,b.top,b.right,b.bottom],width:innerWidth,height:innerHeight};})()")
            assert mobile['a'][3] <= mobile['b'][1] and mobile['b'][2] <= mobile['width'], mobile
            page.js("(() => {const d=window.snakeDebug, set=d.game.setTurn;d.game.setTurn=value=>{window.lastTouchTurn=value;set(value);};})()")
            x = mobile['b'][0] * .25 + mobile['b'][2] * .75
            y = mobile['b'][3] - 18
            page.call('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 9}]})
            assert page.js('window.lastTouchTurn') == 1, 'The visible right touch control must steer right'
            page.call('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            assert page.js('window.lastTouchTurn') == 0, 'Touch release must clear steering'
            mobile['touchPressAndRelease'] = True
            page.screenshot(output / 'mobile.png')
            page.call('Emulation.setTouchEmulationEnabled', {'enabled': False})
            page.call('Emulation.setDeviceMetricsOverride', {'width': 1280, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            page.errors.clear()
            page.call('Page.navigate', {'url': (ROOT / 'index.html').as_uri()})
            for attempt in range(350):
                if page.js("document.querySelectorAll('.surface-preview canvas').length === 6"):
                    break
                time.sleep(.1)
            assert page.js("document.querySelectorAll('.surface-preview canvas').length") == 6, 'All six surface previews must load'
            assert not page.errors, page.errors
            page.screenshot(output / 'selection.png')
            (output / 'results.json').write_text(json.dumps({'desktop': reports, 'mobile': mobile}, indent=2))
            print(json.dumps({'mobile': mobile, 'selectionPreviews': 6}), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.close()


if __name__ == '__main__':
    main()
