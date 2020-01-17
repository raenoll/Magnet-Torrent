import os,bencoding, hashlib
for f_name in os.listdir('1'):
    if f_name.endswith('.torrent'):
   #     print(f_name)

        objTorrentFile = open("1/%s" % f_name, "rb")
        decodedDict = bencoding.bdecode(objTorrentFile.read())

        info_hash = hashlib.sha1(bencoding.bencode(decodedDict[b"info"])).hexdigest()

        print('magnet:?xt=urn:btih:%s' % info_hash)




