import importlib
import inspect
import pkgutil
import sys

from pydantic import BaseModel

# Import all public names (no leading underscore) that are defined in each submodule.
# Names imported into a module from elsewhere (e.g. SQLModel, Field) are excluded
# by checking that obj.__module__ matches the submodule being loaded.
for _module_info in pkgutil.iter_modules(__path__):
    _module_name = _module_info.name
    if _module_name.startswith("_"):
        continue

    _full_module_name = f"{__name__}.{_module_name}"
    _module = importlib.import_module(_full_module_name)

    for _name, _obj in vars(_module).items():
        if _name.startswith("_"):
            continue
        if getattr(_obj, "__module__", None) == _full_module_name:
            globals()[_name] = _obj


# Rebuild forward references for all Pydantic models in this package.
_current_module = sys.modules[__name__]
for _name, _obj in inspect.getmembers(_current_module):
    if (
        inspect.isclass(_obj)
        and issubclass(_obj, BaseModel)
        and not _obj.__module__.startswith("pydantic")
    ):
        try:
            _obj.model_rebuild()
        except Exception as e:
            raise RuntimeError(f"Failed to rebuild {_name}: {e}")
