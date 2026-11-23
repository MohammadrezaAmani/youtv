#!/usr/bin/env python3
"""Run with `python3 -m unittest discover -s scripts -p test_curate_iptv_sources.py`."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('iptv_curator', HERE / 'curate_iptv_sources.py')
import sys
curator = importlib.util.module_from_spec(spec)
sys.modules['iptv_curator'] = curator
spec.loader.exec_module(curator)


class CurateTests(unittest.TestCase):
    def test_domain_dedupe_and_recoverable_dns_archive(self):
        with tempfile.TemporaryDirectory() as root_dir:
            root=Path(root_dir)
            src=root/'sources'/'Iran'
            src.mkdir(parents=True)
            (src/'News.m3u').write_text('\n'.join([
                '#EXTM3U',
                '#EXTINF:-1 group-title="News",Good News',
                '#EXTVLCOPT:http-user-agent=smartlabs',
                'https://good.example.org/stream.m3u8?access=abc',
                '#EXTINF:-1,Duplicate',
                '#EXTVLCOPT:http-user-agent=smartlabs',
                'https://GOOD.example.org/stream.m3u8?access=abc',
                '#EXTINF:-1,Dead News',
                'https://www.mytrinity.com.ua/channel.m3u8',
                '#EXTINF:-1,Uncertain',
                'https://uncertain.example.org/tv.m3u8',
                '#EXTINF:-1,Invalid',
                'https://localhost.local/streams',
            ]), encoding='utf-8')
            (root/'sources'/'README.md').write_text('# Sources', encoding='utf-8')
            (src/'README.md').write_text('# News\n\n![logo](logo.png)', encoding='utf-8')
            (src/'logo.png').write_bytes(b'PNG-TEST-ASSET')
            states={'good.example.org':'resolved', 'www.mytrinity.com.ua':'nxdomain',
                    'uncertain.example.org':'uncertain','localhost.local':'private'}
            report=curator.curate(root/'sources',root/'published',root/'archive',dns_lookup=lambda host:states[host])
            self.assertEqual(report['uniqueUrls'],4)
            self.assertEqual(report['verifiedUrls'],1)
            self.assertEqual(report['duplicates'],1)
            self.assertEqual(report['archived']['nxdomain'],1)
            self.assertEqual(report['archived']['uncertain'],1)
            self.assertEqual(report['archived']['private'],1)
            active=(root/'published'/'online.m3u8').read_text()
            self.assertIn('#EXTVLCOPT:http-user-agent=smartlabs',active)
            self.assertNotIn('mytrinity',active)
            self.assertIn('mytrinity',(root/'archive'/'nxdomain.m3u8').read_text())
            report=json.loads((root/'published'/'summary.json').read_text())
            self.assertEqual(report['verifiedUrls'],1)
            self.assertTrue((src/'News.m3u').exists())
            self.assertTrue((root/'published'/'collections'/'Iran'/'News.m3u').exists())
            self.assertEqual((root/'published'/'collections'/'Iran'/'logo.png').read_bytes(),b'PNG-TEST-ASSET')
            self.assertTrue((root/'published'/'collections'/'Iran'/'README.md').exists())
            self.assertEqual(json.loads((root/'published'/'dns-status.json').read_text())['nxdomain'],
                             ['www.mytrinity.com.ua'])

    def test_hls_segments_are_not_mistaken_for_iptv_stations(self):
        with tempfile.TemporaryDirectory() as dirname:
            root=Path(dirname)
            (root/'hls.m3u8').write_text('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5,\nhttps://media.example.org/segment.ts\n#EXT-X-ENDLIST\n')
            self.assertEqual(list(curator.read_source(root/'hls.m3u8',root)),[])

    def test_global_epg_metadata_is_kept_per_station(self):
        with tempfile.TemporaryDirectory() as dirname:
            root=Path(dirname)
            (root/'epg.m3u').write_text('#EXTM3U x-tvg-url="https://guide.example.org/epg.xml"\n'
                                        '#EXTINF:-1,TV One\nhttps://media.example.org/live.m3u8\n')
            entry=list(curator.read_source(root/'epg.m3u',root))[0]
            self.assertIn('x-tvg-url="https://guide.example.org/epg.xml"',entry.lines[0])

    def test_url_normalization_preserves_signed_queries(self):
        host,key=curator.stream_host('HTTPS://EXAMPLE.ORG/live.m3u8?token=Hello&second=X')
        self.assertEqual(host,'example.org')
        self.assertEqual(key,'https://example.org/live.m3u8?token=Hello&second=X')

if __name__ == '__main__':
    unittest.main()
