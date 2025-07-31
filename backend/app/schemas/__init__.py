import importlib
import inspect
import pkgutil
import sys

from pydantic import BaseModel

# do from .module import * for all modules in this package
for module_info in pkgutil.iter_modules(__path__):
    module_name = module_info.name
    if module_name.startswith("_"):
        continue

    full_module_name = f"{__name__}.{module_name}"
    module = importlib.import_module(full_module_name)

    if not hasattr(module, "__all__"):
        continue

    names = module.__all__

    globals().update({name: getattr(module, name) for name in names})


# Rebuild forward references for all Pydantic models in this module
current_module = sys.modules[__name__]
for name, obj in inspect.getmembers(current_module):
    if (
        inspect.isclass(obj)
        and issubclass(obj, BaseModel)
        and not obj.__module__.startswith("pydantic")
    ):
        try:
            obj.model_rebuild()
        except Exception as e:
            raise RuntimeError(f"Failed to rebuild {name}: {e}")
