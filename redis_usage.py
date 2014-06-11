#! /usr/bin/python
from argparse import ArgumentParser


def compute_redis_usage(users, daily_calls, monthly_revocations):
    return (users * 280 +
            daily_calls * users * 1365 +
            monthly_revocations * 150 + 600000)


def main():
    parser = ArgumentParser(description="Compute redis usage for loop")

    parser.add_argument(
        dest='users',
        help='The number of users that will be using this server',
        type=int,
        default=None)

    parser.add_argument(
        dest='daily_calls',
        help='The number calls that will be done per user (average)',
        type=int,
        default=None)

    parser.add_argument(
        dest='monthly_revocations',
        help='The number of revocation, per month',
        type=int,
        default=0)

    args = parser.parse_args()

    usage = compute_redis_usage(
        args.users,
        args.daily_calls,
        args.monthly_revocations
    )

    text = ("Usage for {users} users, with {daily_calls} calls "
            "per user and {monthly_revocations} revocations (per month) is "
            "{usage} bytes")

    print(text.format(**{
        'users': args.users,
        'daily_calls': args.daily_calls,
        'monthly_revocations': args.monthly_revocations,
        'usage': usage
    }))

if __name__ == '__main__':
    main()
