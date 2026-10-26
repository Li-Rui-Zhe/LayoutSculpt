"""Local installation identity, not an authentication credential."""

import hashlib
import os

from .config import ROOT


def path_key(path):
    value = str(path.resolve()).replace("\\", "/")
    return value.lower() if os.name == "nt" else value


def project_id():
    return hashlib.sha256(path_key(ROOT).encode()).hexdigest()


def instance_id(settings):
    return hashlib.sha256(f"{path_key(ROOT)}\n{path_key(settings.data_dir)}".encode()).hexdigest()
