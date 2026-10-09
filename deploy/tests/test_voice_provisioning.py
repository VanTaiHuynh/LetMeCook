"""Operator provisioning must not bless renamed/corrupt artifacts or symlinks."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
source=Path(__file__).resolve().parents[1]/'provision-local-voice.py'
spec=importlib.util.spec_from_file_location('voice_provisioning',source);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class VoiceProvisioningTests(unittest.TestCase):
 def run_main(self,directory):
  with patch('sys.argv',[str(source),'--destination',str(directory)]):module.main()
 def test_self_consistent_wrong_model_cannot_be_accepted(self):
  with tempfile.TemporaryDirectory() as folder:
   directory=Path(folder)/'voice';directory.mkdir()
   for name in [*module.FILES,'ATTRIBUTION.json']:(directory/name).write_bytes(b'wrong-model')
   manifest={'voiceId':module.VOICE_ID,'sourceRevision':module.REVISION,'sampleRate':22050,'engineVersion':'1.8.0','files':{name:module.digest(directory/name) for name in [*module.FILES,'ATTRIBUTION.json']}}
   (directory/'manifest.json').write_text(json.dumps(manifest))
   with patch.object(module.urllib.request,'urlopen') as download:
    with self.assertRaises(RuntimeError):self.run_main(directory)
    download.assert_not_called()
   self.assertEqual((directory/(module.VOICE_ID+'.onnx')).read_bytes(),b'wrong-model')
 def test_manifest_subset_is_not_an_idempotent_success(self):
  with tempfile.TemporaryDirectory() as folder:
   directory=Path(folder)/'voice';directory.mkdir();(directory/'manifest.json').write_text(json.dumps({'voiceId':module.VOICE_ID,'sourceRevision':module.REVISION,'files':{}}))
   with patch.object(module.urllib.request,'urlopen') as download:
    with self.assertRaises(RuntimeError):self.run_main(directory)
    download.assert_not_called()
 def test_symlink_destination_is_rejected(self):
  with tempfile.TemporaryDirectory() as folder:
   target=Path(folder)/'target';target.mkdir();link=Path(folder)/'voice';link.symlink_to(target,target_is_directory=True)
   with self.assertRaises(RuntimeError):self.run_main(link)
   self.assertEqual(list(target.iterdir()),[])
