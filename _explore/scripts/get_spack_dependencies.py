
import argparse
import json
import sys

from collections import OrderedDict, defaultdict
from pathlib import Path

import spack
import spack.repo as sr

description = """
Spack Dependency Analyzer

The Spack dependency analyer creates a json modeling of Spack packages
and related interdependencies and generates
"""


DEPENDENCY_DB = defaultdict(OrderedDict)
DEPENDENT_DB = defaultdict(OrderedDict)

data_root = Path().cwd() / ".." / ".." / "explore" / "github-data"

def extract_arbitrary_attributes(attr_name, object):
    try:
        ret = getattr(object, attr_name)
    except AttributeError:
        ret = None
    return str(ret) if not ret is None else "all"


def populate_package_info(packages):
    def extract_languages(pkg_cls):
        languages = []
        deps = [x for i,j in pkg_cls.dependencies.items() for x,z in j.items()]
        if "python" in deps:
            languages.append("python")
        if "cmake" in deps:
            languages.append("cmake")
        if "go" in deps:
            languages.append("go")
        if "rust" in deps:
            languages.append("rust")
        if "lua" in deps:
            languages.append("lua")
        if "fortran" in deps:
            languages.append("fortran")
        if "cxx" in deps:
            languages.append("cxx")
        if "c" in deps:
            languages.append("c")
        return languages

    def process_versions(pkg_versions):
        ret_versions = []
        for version in pkg_versions:
            str_ver = str(version)
            if str_ver == ":":
                ret_versions.append("all")
            elif ":" in str(version):
                if str_ver[0] == ":":
                    ret_versions.append(str_ver.replace(":", "<"))
                elif str_ver[-1] == ":":
                    ret_versions.append(str_ver.replace(":", ">"))
                else:
                    ret_versions.append(str_ver.replace(":", "<->"))
            else:
                ret_versions.append(str_ver)
        return ret_versions

    def process_variants(variants):
        return [str(x) for x in variants.values()]

    def process_build_flags(flags):
        ret_flags = []
        if "b" in flags:
            ret_flags.append("build")
        if "r" in flags:
            ret_flags.append("run")
        if "l" in flags:
            ret_flags.append("link")
        if "t" in flags:
            ret_flags.append("test")
        return ret_flags

    for pkg in sr.PATH.all_package_classes():
        for k, v in pkg.dependencies.items():
            # k: pkg spec constraint
            # v: dependencies
            for name, dep in v.items():
                spec = dep.spec
                versions = process_versions(dep.spec.versions)
                variants = process_variants(dep.spec.variants)
                dep_flags = process_build_flags(spack.deptypes.flag_to_chars(dep.depflag))
                platform = extract_arbitrary_attributes("platform", spec)
                target = extract_arbitrary_attributes("target", spec)
                languages = extract_languages(pkg)

                dependent_conditions = {
                    "versions": versions,
                    "variants": variants,
                    "dep_flags": dep_flags,
                    "platform": platform,
                    "target": target,
                }

                dependency_conditions = {
                    "versions": process_versions(k.versions),
                    "variants": process_variants(k.variants),
                    "dep_flags": dep_flags,
                    "platform": extract_arbitrary_attributes("platform", k),
                    "target": extract_arbitrary_attributes("target", k)
                }
                # add package to dependency tracker
                if pkg.name in packages:
                    DEPENDENCY_DB[pkg.name][name] = dependency_conditions
                    DEPENDENCY_DB[pkg.name]["languages"] = languages
                if name in packages:
                    DEPENDENT_DB[name][pkg.name] = dependent_conditions
                    DEPENDENT_DB[name][pkg.name]["languages"] = languages
                # Dependencies map dep conditions to packages
                # name: conditions: pkg: [v] (append to k list if pkg already in this context)

def populate_json_context():
    data_root.mkdir(parents=True, exist_ok=True)
    with (data_root / "spackPackageDependents.json").open("w+") as f:
        f.write(json.dumps(DEPENDENT_DB, default=list))
    with (data_root / "spackPackageDependencies.json").open("w+") as f:
        f.write(json.dumps(DEPENDENCY_DB, default=list))


def read_input_list(input_file):
    package_manifest = {}
    with open(input_file, "r+") as f:
        package_manifest = json.loads(f.read())
    packages = []
    def check_add_valid_repo(qualified_repo):
        repo_pkg = qualified_repo.split("/")
        if len(repo_pkg) > 1:
            _, package = repo_pkg
        else:
            package = repo_pkg[0]
        if sr.PATH.exists(package):
            packages.append(package)
    for qualified_repo in package_manifest["https://github.com"]["repos"]:
        check_add_valid_repo(qualified_repo)
    for qualified_repo in package_manifest["https://gitlab.com"]["repos"]:
        check_add_valid_repo(qualified_repo)
    return packages


def package_dependencies(packages):
    populate_package_info(packages)
    populate_json_context()


if __name__ == "__main__":
    args = argparse.ArgumentParser("spack_dependency_analyzer", description=description)
    args.add_argument(
        "packages",
        nargs="*",
        help="packages to produce dependency information for"
    )
    args.add_argument(
        "--input-list",
        "-il",
        dest="file_input"
    )
    cli = args.parse_args(sys.argv[1:])
    if cli.file_input:
        cli.packages.extend(read_input_list(cli.file_input))
    package_dependencies(cli.packages)


