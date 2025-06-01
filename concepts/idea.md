Given the following definition:
```
url: https://www.airbnb.com/users/show/102012735
instructions:
    - click 'view all listings' if found
    - repeatedly:
            - click 'show more listings' if found
    - extract all listings: listing name, listing url
```

will be translated to:
```json
{
    "url": "https://www.airbnb.com/users/show/102012735",
    "instructions": [
        {
            "name": "condition",
            "prompt": "find element for \"click 'view all listings'\"",
            "success_instructions": [
                {
                    "name": "click",
                    "prompt": "click 'view all listings'"
                }
            ],
            "failure_instructions": [
            ]
        },
        {
            "name": "repeat",
            "instructions": [
                {
                    "name": "condition",
                    "prompt": "find element for \"click 'show more listings'\"",
                    "success_instructions": [
                        {
                            "name": "click",
                            "prompt": "click 'show more listings'"
                        }
                    ],
                    "failure_instructions": [
                    ]
                }
            ]
        },
        {
            "name": "extract",
            "prompt": "extract all listings: listing name, listing url"
        }
    ]
}
```