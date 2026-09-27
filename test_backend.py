"""Regression checks use isolated fixtures; never insert example data into the app."""
import copy
import json
import tempfile
import unittest
import threading
from urllib.request import urlopen, Request
from pathlib import Path
from unittest.mock import patch
import documents
import server
import storage

class Checks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.db_patch=patch.object(storage,'DB',Path(self.temp.name)/'test.db')
        self.db_patch.start()
    def tearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()
    def cell(self,v,loc='p1:l1'):
        return {'value':v,'locations':[loc]}
    def extraction(self):
        c=self.cell
        item={k:c(v) for k,v in {'sku':'SKU-1','description':'Part','quantity':2,'unit_price':10,'line_total':20}.items()}
        inv={k:c(v) for k,v in {'reference':'I-1','order_reference':'P-1','currency':'EUR','supplier':'Supplier','net':20,'vat':4,'total':24,'vat_rate':0.2}.items()}
        inv['items']=[item]
        po=copy.deepcopy(inv);po['reference']=c('P-1')
        rec=copy.deepcopy(po);rec['reference']=c('R-1')
        return {'invoice':inv,'purchase_order':po,'receiving_record':rec}
    def analyze(self,fields):
        files={k:(k+'.txt',b'I-1 P-1 R-1 EUR Supplier SKU-1 Part 2 10 20 4 24 0.2 12') for k in fields}
        return documents.analyze(files,lambda *_:fields)
    def test_multiline_arithmetic_and_currency(self):
        f=self.extraction();f['invoice']['items'][0]['unit_price']=self.cell(12)
        result=self.analyze(f)
        self.assertTrue(any('unit price' in x['title'] for x in result['findings']))
        self.assertEqual(result['currency'],'EUR')
        self.assertTrue(all(x['evidence'] for x in result['findings']))
    def test_unrelated_orders_not_compared(self):
        f=self.extraction();f['invoice']['order_reference']=self.cell('OTHER')
        r=self.analyze(f)
        self.assertFalse(any('ordered' in x['title'] for x in r['checks']))
    def test_missing_currency_not_assumed(self):
        f=self.extraction();f['invoice']['currency']=self.cell(None)
        r=self.analyze(f)
        self.assertEqual(r['currency'],'currency unspecified')
        self.assertFalse(any('order unit price' in x['title'] for x in r['checks']))
    def test_invalid_citation_excluded(self):
        f=self.extraction();f['invoice']['total']=self.cell(24,'p99:l99')
        r=self.analyze(f)
        self.assertIsNone(r['invoice_total'])
        self.assertTrue(any('invalid source' in x for x in r['limitations']))
    def test_nonfinite(self):
        for x in ('NaN','Infinity',True,-1):self.assertIsNone(documents.numeric(x))
    def rows(self):
        return [{'trace_id':str(i),'tool':'test','status':'recorded','message':'result','agent_reply':'reply','run_id':str(i)} for i in range(2)]
    def test_duplicate_ids_rejected_before_inference(self):
        rows=self.rows();rows[1]['trace_id']='0'
        with self.assertRaisesRegex(ValueError,'unique'):server.analyze_logs(rows)
    def test_invented_evidence_rejects_whole_group(self):
        with patch.object(server,'nim_json',return_value={'issues':[{'trace_ids':['0','1','invented']}]}):
            self.assertEqual(server.analyze_logs(self.rows())['issues'],[])
    def test_one_run_not_recurring(self):
        rows=self.rows();rows[1]['run_id']='0'
        with patch.object(server,'nim_json',return_value={'issues':[{'trace_ids':['0','1']}]}):
            self.assertEqual(server.analyze_logs(rows)['issues'],[])
    def test_persistence_and_decision(self):
        self.assertEqual(storage.list_runs(),[])
        r=storage.save('documents','success',self.analyze(self.extraction()))
        storage.decide(r['id'],'reviewed')
        self.assertEqual(storage.list_runs()[0]['decision'],'reviewed')
        self.assertEqual(len(storage.list_runs()[0]['decisions']),1)
    def test_benchmark_has_original_context_no_reward_labels(self):
        data=server.public_traces()
        self.assertGreaterEqual(len(data['logs']),2)
        self.assertLess(len(json.dumps(data['logs'])),240000)
        for row in data['logs']:
            events=json.loads(row['context'])
            self.assertTrue(any(e['role']=='tool' for e in events))
            self.assertNotIn('reward',row)
    def test_empty_document_rejected(self):
        with self.assertRaises(ValueError):documents.lines_from_file('empty.txt',b'')

    def test_http_document_and_reliability_workflows_with_isolated_model(self):
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        worker=threading.Thread(target=http.serve_forever,daemon=True);worker.start()
        base=f'http://127.0.0.1:{http.server_port}'
        def post(path,data,content_type='application/json'):
            return json.load(urlopen(Request(base+path,data=data,headers={'Content-Type':content_type})))
        try:
            self.assertEqual(json.load(urlopen(base+'/api/runs'))['runs'],[])
            body=b'--test-boundary\r\nContent-Disposition: form-data; name="invoice"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nI-1 P-1 R-1 EUR Supplier SKU-1 Part 2 10 20 4 24 0.2\r\n--test-boundary--\r\n'
            with patch.object(server,'nim_json',return_value={'invoice':self.extraction()['invoice']}):
                case=post('/api/documents/analyze',body,'multipart/form-data; boundary=test-boundary')
            self.assertEqual(case['status'],'success')
            decision=post('/api/decision',json.dumps({'id':case['id'],'decision':'reviewed'}).encode())
            self.assertEqual(decision['decision'],'reviewed')
            with patch.object(server,'nim_json',return_value={'issues':[{'trace_ids':['0','1'],'severity':'High','title':'Observed problem','explanation':'Model test response','fix':'Review'}]}):
                result=post('/api/agent-failures',json.dumps({'logs':self.rows()}).encode())
            self.assertEqual(result['issues'][0]['priority_score'],4)
            self.assertEqual(len(json.load(urlopen(base+'/api/runs'))['runs']),2)
            self.assertEqual(len(json.load(urlopen(base+'/api/traces'))['logs']),2)
        finally:
            http.shutdown();http.server_close();worker.join()

if __name__=='__main__':unittest.main()
