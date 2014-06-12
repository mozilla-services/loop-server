#! /usr/bin/python
from argparse import ArgumentParser, ArgumentDefaultsHelpFormatter
import json

BARE_REDIS = 600000
USER_WEIGHT = 280
CALL_WEIGHT = 1365
REVOCATION_WEIGHT = 150


def get_version():
    """Returns the version contained in the package.json file"""
    with open('package.json') as f:
        package = json.load(f)
        return package['version']


def compute_redis_usage(users, daily_calls, monthly_revocations):
    """Computes the redis usage, in megabytes"""
    return ((users * USER_WEIGHT +
            daily_calls * users * CALL_WEIGHT +
            monthly_revocations * REVOCATION_WEIGHT + BARE_REDIS)
            / 1024) / 1024


def main():
    parser = ArgumentParser(
        description="Compute redis usage for loop",
        formatter_class=ArgumentDefaultsHelpFormatter)

    parser.add_argument(
        dest='users',
        help='The number of users that will be using this server',
        type=int)

    parser.add_argument(
        dest='daily_calls',
        help='The number calls that will be done per user (average)',
        type=int)

    parser.add_argument(
        dest='monthly_revocations',
        nargs='?',
        help='The number of revocation, per month',
        type=int,
        default=0)

    args = parser.parse_args()

    usage = compute_redis_usage(
        args.users,
        args.daily_calls,
        args.monthly_revocations
    )

    text = ("loop-server: v{version}\n"
            "Usage for {users} users, with {daily_calls} daily calls "
            "per user and {monthly_revocations} monthly revocations is "
            "{usage} MBytes")

    print(text.format(**{
        'version': get_version(),
        'users': args.users,
        'daily_calls': args.daily_calls,
        'monthly_revocations': args.monthly_revocations,
        'usage': usage
    }))

if __name__ == '__main__':
    main()
