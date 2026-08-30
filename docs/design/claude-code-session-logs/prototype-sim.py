import json,sys,glob,datetime
PRICE={'claude-opus-5':(5,25),'claude-opus-4-8':(5,25),'claude-sonnet-5':(2,10),'claude-haiku-4-5':(1,5)}
def load(f):
    rows={}
    for line in open(f):
        try: d=json.loads(line)
        except: continue
        if d.get('type')!='assistant': continue
        m=d.get('message',{})
        mid=m.get('id')
        if not mid or m.get('model','').startswith('<'): continue
        u=m.get('usage') or {}
        if mid in rows: continue          # dedup
        rows[mid]=dict(
            ts=datetime.datetime.fromisoformat(d['timestamp'].replace('Z','+00:00')),
            model=m.get('model'), side=d.get('isSidechain',False),
            inp=u.get('input_tokens',0), out=u.get('output_tokens',0),
            read=u.get('cache_read_input_tokens',0),
            w5=(u.get('cache_creation') or {}).get('ephemeral_5m_input_tokens',0),
            w1=(u.get('cache_creation') or {}).get('ephemeral_1h_input_tokens',0),
            wtot=u.get('cache_creation_input_tokens',0))
    return sorted(rows.values(), key=lambda r:r['ts'])

def cost(rows, ttl):
    total=0.0; expired=0
    prev=None
    for r in rows:
        pi,po=PRICE.get(r['model'],(5,25))
        gap=(r['ts']-prev).total_seconds() if prev else 1e9
        prev=r['ts']
        wmult=1.25 if ttl==300 else 2.0
        read=r['read']; write=r['wtot']
        if gap>ttl and read>0:      # entry would have lapsed -> re-written, not read
            write+=read; read=0; expired+=1
        total += (r['inp']*pi + read*0.1*pi + write*wmult*pi + r['out']*po)/1e6
    return total,expired

for f in sorted(glob.glob(sys.argv[1])):
    rows=load(f)
    if not rows: continue
    c5,e5=cost(rows,300); c1,e1=cost(rows,3600)
    dur=(rows[-1]['ts']-rows[0]['ts']).total_seconds()/60
    print(f"{f.split('/')[-1][:8]}  reqs={len(rows):4d} span={dur:6.1f}m  5m=${c5:7.4f}(lapse {e5})  1h=${c1:7.4f}(lapse {e1})  best={'5m' if c5<c1 else '1h'} save=${abs(c5-c1):.4f}")
